import type { StyleSheet, Rule, Declaration, Value, FunctionValue, KeyframeRule, KeyframeBlock, StateRule, DefinitionRule } from '@popcorn/parser';
import {
  isLengthValue,
  isColorValue,
  isKeywordValue,
  isNumberValue,
  isStringValue,
  isFunctionValue,
  isListValue,
  isVariableRefValue,
  getNumericValue,
  getStringValue,
} from '@popcorn/parser';
import type {
  SceneNode,
  ShapeType,
  Transform,
  KeyframeData,
  AnimatableValue,
  TimingFunction,
  StepPosition,
  LinearEasingPoint,
  AnimationDirection,
  AnimationFillMode,
  CompositeOperation,
  RectData,
  CircleData,
  EllipseData,
  PathData,
  TextData,
  PolystarData,
  ShapeData,
  TextAnchor,
  TransformOriginValue,
  StateStyles,
  TransitionSpec,
  ClipPathData,
  ImageData,
  MaskMode,
  TimeRemapStop,
} from './types';
import type { PathCommand } from '../renderer/types';
import type { GradientData, GradientStop } from '../renderer/types';
import { isGradientData } from '../renderer/types';
import { createSceneNode, createDefaultTransformOrigin, snapshotNode } from './types';
import { parsePath, buildMotionPath } from './path-parser';
import { clamp01 } from './transform';
import { gradientsCompatible, pathsCompatible } from '../animation/registry';

const isPolystar = (sd: ShapeData): sd is PolystarData =>
  sd.type === 'star' || sd.type === 'polygon';

// One warning per animation whose object-valued keyframes (gradients/paths)
// can't interpolate — interpolation will step to the departing value instead.
const warnedAnimations = new Set<string>();
function warnIncompatibleObjectKeyframes(name: string, frames: KeyframeData[]): void {
  const sorted = [...frames].sort((a, b) => a.offset - b.offset);
  for (const prop of ['fill', 'stroke', 'd', 'clip-path'] as const) {
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].properties[prop];
      const b = sorted[i + 1].properties[prop];
      if (a === undefined || b === undefined) continue;
      let ok: boolean;
      if (prop === 'd' || prop === 'clip-path') {
        ok = Array.isArray(a) && Array.isArray(b) && pathsCompatible(a, b);
      } else if (!isGradientData(a) && !isGradientData(b)) {
        ok = true; // plain color-to-color fill/stroke: interpolates fine
      } else {
        ok = isGradientData(a) && isGradientData(b) && gradientsCompatible(a, b);
      }
      if (!ok && !warnedAnimations.has(name)) {
        warnedAnimations.add(name);
        console.warn(
          `@keyframes ${name}: incompatible ${prop} keyframes; animation will step (hold) instead of interpolating.`
        );
      }
    }
  }
}

/**
 * Build scene graph from AST
 */
type TransformKey = 'translateX' | 'translateY' | 'rotate' | 'scaleX' | 'scaleY';

/**
 * Walk a transform value (a single function or a list of them) and report each
 * resolved channel to `set`. Single source for the translate/rotate/scale
 * function-name mapping — used for base transforms, state styles, and keyframes.
 */
function extractTransform(value: Value, set: (key: TransformKey, val: number) => void): void {
  const single = (name: string, args: Value[]) => {
    switch (name) {
      case 'translate':
        set('translateX', getNumericValue(args[0]));
        set('translateY', args.length > 1 ? getNumericValue(args[1]) : 0);
        break;
      case 'translateX':
        set('translateX', getNumericValue(args[0]));
        break;
      case 'translateY':
        set('translateY', getNumericValue(args[0]));
        break;
      case 'rotate':
        set('rotate', getNumericValue(args[0]));
        break;
      case 'scale': {
        const sx = getNumericValue(args[0]);
        set('scaleX', sx);
        set('scaleY', args.length > 1 ? getNumericValue(args[1]) : sx);
        break;
      }
      case 'scaleX':
        set('scaleX', getNumericValue(args[0]));
        break;
      case 'scaleY':
        set('scaleY', getNumericValue(args[0]));
        break;
    }
  };

  if (isFunctionValue(value)) {
    single(value.name, value.args);
  } else if (isListValue(value)) {
    for (const v of value.values) {
      if (isFunctionValue(v)) single(v.name, v.args);
    }
  }
}

/**
 * Map a CSS individual transform property (`translate`/`rotate`/`scale`) onto
 * the transform channels, reporting each to `set`. Values are bare (not
 * functions): `translate: <x> [<y>]`, `rotate: <angle>`, `scale: <n> [<n>]`.
 * Returns false for any other property.
 *
 * ponytail: these write the SAME channels as the `transform:` shorthand (single
 * source of transform math, invariant #1) rather than modeling CSS's separate
 * translate/rotate/scale/transform layering. So mixing them with `transform:` on
 * one node is last-declaration-wins per channel, not additive layering.
 */
function extractIndividualTransform(
  property: string,
  value: Value,
  set: (key: TransformKey, val: number) => void
): boolean {
  const parts = isListValue(value) ? value.values : [value];
  switch (property) {
    case 'translate':
      set('translateX', getNumericValue(parts[0]));
      set('translateY', parts.length > 1 ? getNumericValue(parts[1]) : 0);
      return true;
    case 'rotate':
      set('rotate', getNumericValue(parts[0]));
      return true;
    case 'scale': {
      const sx = getNumericValue(parts[0]);
      set('scaleX', sx);
      set('scaleY', parts.length > 1 ? getNumericValue(parts[1]) : sx);
      return true;
    }
  }
  return false;
}

export class SceneBuilder {
  private keyframesMap: Map<string, KeyframeRule> = new Map();
  private definitionsMap: Map<string, DefinitionRule> = new Map();
  // Static :root custom properties, for build-time resolution of static var()
  // references on non-animatable string properties (e.g. a hoisted image
  // `content: url(...)`).
  private variablesMap: Map<string, Value> = new Map();
  // Nodes that authored a `mask:` reference, resolved to source nodes once the
  // whole tree is built (the source can live anywhere in the scene).
  private pendingMasks: { node: SceneNode; sourceId: string; mode: MaskMode }[] = [];

  build(stylesheet: StyleSheet): SceneNode {
    // Index keyframes and symbol definitions by name
    for (const kf of stylesheet.keyframes) {
      this.keyframesMap.set(kf.name, kf);
    }
    for (const def of stylesheet.definitions) {
      this.definitionsMap.set(def.name, def);
    }
    for (const v of stylesheet.variables) {
      this.variablesMap.set(v.name, v.value);
    }

    // Create root node
    const root = createSceneNode('root', 'group');

    // Process rules
    for (const rule of stylesheet.rules) {
      const node = this.buildNode(rule);
      node.parent = root;
      root.children.push(node);
    }

    this.resolveMasks(root);

    return root;
  }

  /**
   * Wire up authored `mask:` references now that every node exists. The mask
   * source is looked up by id anywhere in the scene; the referenced node is
   * flagged so the renderer paints it only as a mask, never on its own.
   */
  private resolveMasks(root: SceneNode): void {
    if (this.pendingMasks.length === 0) return;
    const byId = new Map<string, SceneNode>();
    const index = (n: SceneNode) => { byId.set(n.id, n); n.children.forEach(index); };
    index(root);

    for (const { node, sourceId, mode } of this.pendingMasks) {
      const source = byId.get(sourceId);
      if (!source) {
        throw new Error(`mask on '${node.id}' references unknown node '#${sourceId}'`);
      }
      node.mask = { source, mode };
      source.isMaskSource = true;
    }
    this.pendingMasks = [];
  }

  private buildNode(rule: Rule): SceneNode {
    // Expand a `use: <symbol>` reference into a merged rule before building.
    rule = this.expandUse(rule);

    const id = rule.selector.name;
    let shapeType: ShapeType = 'group';

    // First pass: find shape type
    for (const decl of rule.declarations) {
      if (decl.property === 'type') {
        shapeType = getStringValue(decl.value) as ShapeType;
        break;
      }
    }

    const node = createSceneNode(id, shapeType);

    if (rule.selector.type === 'class') {
      node.className = id;
    }

    // Apply declarations
    this.applyDeclarations(node, rule.declarations);

    // Resolve the `animation` shorthand together with the `animation-*`
    // longhands (CSS composition: later declarations win per sub-property).
    this.resolveAnimations(node, rule.declarations);

    // Node-level transitions (apply to interaction state changes).
    node.transitions = this.resolveTransitions(rule.declarations);

    // Extract state-specific styles from pseudo rules
    if (rule.states && rule.states.length > 0) {
      for (const stateRule of rule.states) {
        const stateStyles = this.buildStateStyles(stateRule);
        if (stateRule.state === 'hover') {
          node.hoverStyles = stateStyles;
        } else if (stateRule.state === 'active') {
          node.activeStyles = stateStyles;
        }
      }
      // Mark node as interactive if it has any state styles
      node.interactive = true;
    }

    // Process children
    for (const childRule of rule.children) {
      const childNode = this.buildNode(childRule);
      childNode.parent = node;
      node.children.push(childNode);
    }

    // Capture the authored render state as the immutable base for the
    // per-frame value-resolution pipeline.
    node.base = snapshotNode(node);

    return node;
  }

  /**
   * Resolve a rule's `use: <symbol>` reference into a concrete rule by merging
   * the definition (deep-cloned) with the use-site. Use-site declarations
   * override the definition's (last wins); the definition's children are cloned
   * with namespaced ids and the use-site's children appended; a use-site state
   * block replaces the definition's for the same pseudo. Returns the rule
   * unchanged when it has no `use`. Detects cycles via the in-progress set.
   */
  private expandUse(rule: Rule, inProgress: Set<string> = new Set()): Rule {
    const useDecl = rule.declarations.find((d) => d.property === 'use');
    if (!useDecl) return rule;

    const name = getStringValue(useDecl.value);
    const def = this.definitionsMap.get(name);
    if (!def) {
      throw new Error(`unknown symbol '${name}' referenced by use: in rule '${rule.selector.name}'`);
    }
    if (inProgress.has(name)) {
      throw new Error(`cyclic symbol definition: ${[...inProgress, name].join(' -> ')}`);
    }
    inProgress.add(name);

    // Resolve the definition's own body first (it may `use:` another symbol).
    const resolvedDef = this.expandUse(
      { type: 'rule', selector: { type: 'id', name }, declarations: def.declarations, children: def.children, states: def.states },
      inProgress
    );
    inProgress.delete(name);

    const instanceId = rule.selector.name;
    return {
      type: 'rule',
      selector: rule.selector,
      // Def declarations first, use-site second so use-site overrides win; the
      // `use` decl itself is dropped from both.
      declarations: [
        ...resolvedDef.declarations.filter((d) => d.property !== 'use'),
        ...rule.declarations.filter((d) => d.property !== 'use'),
      ],
      // Cloned+namespaced def children, then the use-site's own children.
      children: [
        ...resolvedDef.children.map((c) => namespaceChild(c, instanceId)),
        ...rule.children,
      ],
      states: mergeStates(resolvedDef.states, rule.states),
    };
  }

  /**
   * Build state-specific styles from a StateRule
   */
  private buildStateStyles(stateRule: StateRule): StateStyles {
    const styles: StateStyles = {};

    for (const decl of stateRule.declarations) {
      const { property, value } = decl;

      switch (property) {
        case 'fill':
          if (isColorValue(value)) {
            styles.fill = value.value;
          } else if (isKeywordValue(value)) {
            if (value.value === 'none') {
              styles.fill = null;
            } else {
              styles.fill = value.value;
            }
          } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
            styles.fill = this.buildColorString(value);
          }
          break;

        case 'stroke':
          if (isColorValue(value)) {
            styles.stroke = value.value;
          } else if (isKeywordValue(value)) {
            if (value.value === 'none') {
              styles.stroke = null;
            } else {
              styles.stroke = value.value;
            }
          } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
            styles.stroke = this.buildColorString(value);
          }
          break;

        case 'stroke-width':
          styles.strokeWidth = getNumericValue(value);
          break;

        case 'opacity':
          styles.opacity = getNumericValue(value);
          break;

        case 'transform':
          styles.transform = { ...styles.transform, ...this.extractStateTransform(value) };
          break;

        case 'translate':
        case 'rotate':
        case 'scale': {
          // CSS individual transform properties in a state block: merge into the
          // same channel deltas (last-declaration-wins per channel).
          const t = (styles.transform ??= {});
          extractIndividualTransform(property, value, (key, val) => { t[key] = val; });
          break;
        }
      }
    }

    // Transitions declared inside the state block govern entering that state.
    const transitions = this.resolveTransitions(stateRule.declarations);
    if (transitions.length > 0) styles.transitions = transitions;

    return styles;
  }

  /**
   * Extract transform properties from a transform value for state styles
   */
  private extractStateTransform(value: Value): Partial<Transform> {
    const transform: Partial<Transform> = {};
    extractTransform(value, (key, val) => {
      transform[key] = val;
    });
    return transform;
  }

  private applyDeclarations(node: SceneNode, declarations: Declaration[]): void {
    for (const decl of declarations) {
      this.applyDeclaration(node, decl);
    }
  }

  /** Image source from a `url('…')` function value, or a bare string. */
  private imageSrc(value: Value): string {
    if (isFunctionValue(value) && value.name === 'url') {
      return value.args.length > 0 ? getStringValue(value.args[0]) : '';
    }
    return getStringValue(value);
  }

  private applyDeclaration(node: SceneNode, decl: Declaration): void {
    const { property, value } = decl;

    // Image content (`content: url(...)`) is static, so a `var()` reference to a
    // :root custom property is resolved once here at build time (dedup hoists
    // shared data URIs into :root). This must precede the generic binding path,
    // which is numeric-only.
    if (property === 'content' && node.shapeData.type === 'image' && isVariableRefValue(value)) {
      const resolved = this.variablesMap.get(value.name) ?? value.fallback;
      if (resolved) {
        (node.shapeData as ImageData).src = this.imageSrc(resolved);
      }
      return;
    }

    // Check if this value contains a variable reference
    if (this.hasVariableReference(value)) {
      // Store as a dynamic binding to be resolved at render time
      node.bindings.push({ property, value });
      return;
    }

    switch (property) {
      case 'type':
        // Already handled
        break;

      // Transform properties
      case 'transform':
        this.applyTransform(node, value);
        break;

      // CSS individual transform properties -> the same channels as transform:.
      case 'translate':
      case 'rotate':
      case 'scale':
        extractIndividualTransform(property, value, (key, val) => {
          node.transform[key] = val;
        });
        break;

      case 'transform-origin':
        this.applyTransformOrigin(node, value);
        break;

      // Position/size for rect (x/y are also the text anchor point)
      case 'x':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).x = getNumericValue(value);
        } else if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).x = getNumericValue(value);
        } else if (node.shapeData.type === 'image') {
          (node.shapeData as ImageData).x = getNumericValue(value);
        }
        break;
      case 'y':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).y = getNumericValue(value);
        } else if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).y = getNumericValue(value);
        } else if (node.shapeData.type === 'image') {
          (node.shapeData as ImageData).y = getNumericValue(value);
        }
        break;

      // Text content, or image source (`content: url('…')`).
      case 'content':
        if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).content = getStringValue(value);
        } else if (node.shapeData.type === 'image') {
          (node.shapeData as ImageData).src = this.imageSrc(value);
        }
        break;
      case 'font-size':
        if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).fontSize = getNumericValue(value);
        }
        break;
      case 'font-family':
        if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).fontFamily = getStringValue(value);
        }
        break;
      case 'font-weight':
        if (node.shapeData.type === 'text') {
          // Keyword ('bold') or numeric weight (700) — store as a string for ctx.font.
          (node.shapeData as TextData).fontWeight = isNumberValue(value)
            ? String(value.value)
            : getStringValue(value) || 'normal';
        }
        break;
      case 'text-anchor':
        if (node.shapeData.type === 'text' && isKeywordValue(value) &&
            (value.value === 'start' || value.value === 'middle' || value.value === 'end')) {
          (node.shapeData as TextData).anchor = value.value as TextAnchor;
        }
        break;
      case 'width':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).width = getNumericValue(value);
        } else if (node.shapeData.type === 'image') {
          (node.shapeData as ImageData).width = getNumericValue(value);
        }
        break;
      case 'height':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).height = getNumericValue(value);
        } else if (node.shapeData.type === 'image') {
          (node.shapeData as ImageData).height = getNumericValue(value);
        }
        break;

      case 'rx':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).rx = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).rx = getNumericValue(value);
        }
        break;
      case 'ry':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).ry = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).ry = getNumericValue(value);
        }
        break;

      // Circle/ellipse properties
      case 'cx':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cx = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cx = getNumericValue(value);
        } else if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).cx = getNumericValue(value);
        }
        break;
      case 'cy':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cy = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cy = getNumericValue(value);
        } else if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).cy = getNumericValue(value);
        }
        break;
      case 'r':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).r = getNumericValue(value);
        }
        break;

      // Star / polygon geometry. Synthesized into a path at render time; `sides`
      // is static, the rest are animatable (see the registry).
      case 'sides':
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).sides = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case 'outer-radius':
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).outerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case 'inner-radius':
        if (node.shapeData.type === 'star') {
          (node.shapeData as PolystarData).innerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case 'rotation':
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).rotation = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case 'outer-roundness':
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).outerRoundness = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case 'inner-roundness':
        if (node.shapeData.type === 'star') {
          (node.shapeData as PolystarData).innerRoundness = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;

      // Path
      case 'd':
        if (node.shapeData.type === 'path') {
          const pathStr = getStringValue(value);
          (node.shapeData as PathData).d = pathStr;
          (node.shapeData as PathData).commands = parsePath(pathStr);
        }
        break;

      // Appearance
      case 'fill': {
        const paint = this.parsePaint(value);
        if (paint?.type === 'gradient') {
          // Invalid gradient falls back to no fill.
          node.fillGradient = paint.gradient;
          node.fill = null;
        } else if (paint) {
          node.fill = paint.color;
        }
        break;
      }

      case 'stroke': {
        const paint = this.parsePaint(value);
        if (paint?.type === 'gradient') {
          node.strokeGradient = paint.gradient;
          node.stroke = null;
        } else if (paint) {
          node.stroke = paint.color;
        }
        break;
      }

      case 'clip-path':
        node.clipPath = this.parseClipPath(value);
        break;

      case 'mask':
        this.parseMask(node, value);
        break;

      // CSS Motion Path. offset-path is static (cached arc-length table built
      // once); offset-distance is animatable (registry) so it also lands here as
      // the authored default; offset-rotate is static.
      case 'offset-path':
        if (isFunctionValue(value) && value.name === 'path') {
          const arg = value.args[0];
          if (arg && isStringValue(arg)) {
            node.offsetPath = buildMotionPath(parsePath(arg.value));
          }
        }
        break;
      case 'offset-distance':
        node.offsetDistance = clamp01(normalizeFraction(value));
        break;
      case 'offset-rotate':
        node.offsetRotate = this.parseOffsetRotate(value);
        break;

      case 'stroke-width':
        node.strokeWidth = getNumericValue(value);
        break;

      case 'stroke-linecap':
        if (isKeywordValue(value) && (value.value === 'butt' || value.value === 'round' || value.value === 'square')) {
          node.strokeLineCap = value.value;
        }
        break;

      case 'stroke-linejoin':
        if (isKeywordValue(value) && (value.value === 'miter' || value.value === 'round' || value.value === 'bevel')) {
          node.strokeLineJoin = value.value;
        }
        break;

      case 'stroke-miterlimit':
        node.strokeMiterLimit = getNumericValue(value);
        break;

      // Stroke dashing: a repeating length list, plus an animatable offset.
      case 'stroke-dasharray':
        node.strokeDashArray = isListValue(value)
          ? value.values.map(getNumericValue)
          : [getNumericValue(value)];
        break;
      case 'stroke-dashoffset':
        node.strokeDashOffset = getNumericValue(value);
        break;

      case 'fill-rule':
        if (isKeywordValue(value) && (value.value === 'nonzero' || value.value === 'evenodd')) {
          node.fillRule = value.value;
        }
        break;

      // SVG-style paint order. Only 'stroke' (stroke behind fill) is meaningful
      // here; any other value keeps the default fill-then-stroke.
      case 'paint-order':
        if (isKeywordValue(value)) {
          node.paintOrder = value.value === 'stroke' ? 'stroke' : 'normal';
        }
        break;

      // Trim paths: percentages normalized to 0..1 (like opacity is authored as
      // a fraction) and clamped to range.
      case 'trim-start':
        node.trimStart = clamp01(normalizeFraction(value));
        break;
      case 'trim-end':
        node.trimEnd = clamp01(normalizeFraction(value));
        break;
      case 'trim-offset':
        node.trimOffset = clamp01(normalizeFraction(value));
        break;

      case 'opacity':
        node.opacity = getNumericValue(value);
        break;

      // Per-subtree time scoping (static). time-offset shifts the local
      // timeline later; time-scale compresses/stretches it. Applied to this
      // node and its descendants during the render walk.
      case 'time-offset':
        node.timeOffset = isLengthValue(value) && value.unit === 's'
          ? value.value * 1000
          : getNumericValue(value); // ms (bare number or 'ms')
        break;
      case 'time-scale': {
        const scale = getNumericValue(value);
        if (scale > 0) {
          node.timeScale = scale;
        } else {
          console.warn(`time-scale must be > 0, got ${scale}; using 1`);
          node.timeScale = 1;
        }
        break;
      }

      // Keyframed time remap (static curve). A comma-separated list of
      // `<input-time> <output-time> [easing]` stops maps the subtree's inherited
      // time through a monotonic curve — the general form of time-offset/scale.
      case 'time-remap':
        node.timeRemap = this.parseTimeRemap(value);
        break;

      // Sibling paint order (static integer). See childrenInPaintOrder.
      case 'z-index':
        node.zIndex = getNumericValue(value);
        break;

      // Visibility window (static). Times are stored in ms to match the scoped
      // timeline the resolve walk compares them against (like time-offset).
      case 'visible-from':
        node.visibleFrom = isLengthValue(value) && value.unit === 's'
          ? value.value * 1000
          : getNumericValue(value); // ms (bare number or 'ms')
        break;
      case 'visible-until':
        node.visibleUntil = isLengthValue(value) && value.unit === 's'
          ? value.value * 1000
          : getNumericValue(value); // ms (bare number or 'ms')
        break;

      // The `animation` shorthand and all `animation-*` longhands are resolved
      // together (composed per CSS) by resolveAnimations after this pass.
      case 'animation':
      case 'animation-name':
      case 'animation-duration':
      case 'animation-timing-function':
      case 'animation-iteration-count':
      case 'animation-direction':
      case 'animation-delay':
      case 'animation-fill-mode':
        break;
    }

    // Initialize shape data if not set
    this.ensureShapeData(node);
  }

  private ensureShapeData(node: SceneNode): void {
    if (!node.shapeData || node.shapeData.type !== node.type) {
      switch (node.type) {
        case 'group':
          node.shapeData = { type: 'group' };
          break;
        case 'rect':
          node.shapeData = { type: 'rect', x: 0, y: 0, width: 0, height: 0, rx: 0, ry: 0 };
          break;
        case 'circle':
          node.shapeData = { type: 'circle', cx: 0, cy: 0, r: 0 };
          break;
        case 'ellipse':
          node.shapeData = { type: 'ellipse', cx: 0, cy: 0, rx: 0, ry: 0 };
          break;
        case 'path':
          node.shapeData = { type: 'path', d: '', commands: [] };
          break;
        case 'star':
        case 'polygon':
          node.shapeData = {
            type: node.type,
            sides: 5, outerRadius: 0, innerRadius: 0, rotation: 0,
            cx: 0, cy: 0, outerRoundness: 0, innerRoundness: 0,
          };
          break;
        case 'text':
          node.shapeData = {
            type: 'text', x: 0, y: 0, content: '',
            fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'normal', anchor: 'start',
          };
          break;
        case 'image':
          node.shapeData = { type: 'image', x: 0, y: 0, width: 0, height: 0, src: '' };
          break;
      }
    }
  }

  private applyTransform(node: SceneNode, value: Value): void {
    extractTransform(value, (key, val) => {
      node.transform[key] = val;
    });
  }

  /**
   * Parse transform-origin property
   * Supports:
   * - Keywords: center, top, left, right, bottom, and combinations
   * - Percentages: 50%, 100%
   * - Pixels: 100px, 150px
   * - Mixed: center 100px, 50% top
   */
  private applyTransformOrigin(node: SceneNode, value: Value): void {
    const origin = createDefaultTransformOrigin();

    // Handle single value or list of values
    let values: Value[] = [];
    if (isListValue(value)) {
      values = value.values;
    } else {
      values = [value];
    }

    // Process first value (x-axis or keyword)
    if (values.length >= 1) {
      const firstVal = this.parseTransformOriginValue(values[0], 'x');
      if (firstVal) {
        // Check if it's a y-axis keyword used as first value (e.g., "top")
        if (this.isYAxisKeyword(values[0])) {
          origin.y = firstVal;
          // If single y-axis keyword, x defaults to center (50%)
          origin.x = { value: 50, unit: '%' };
        } else {
          origin.x = firstVal;
        }
      }
    }

    // Process second value (y-axis)
    if (values.length >= 2) {
      const secondVal = this.parseTransformOriginValue(values[1], 'y');
      if (secondVal) {
        // Check if first was a y-axis keyword; if so, this is x
        if (this.isYAxisKeyword(values[0])) {
          origin.x = secondVal;
        } else {
          origin.y = secondVal;
        }
      }
    } else if (values.length === 1) {
      // Single value - handle special cases
      const firstVal = values[0];
      if (isKeywordValue(firstVal) && firstVal.value === 'center') {
        // "center" alone means center on both axes
        origin.x = { value: 50, unit: '%' };
        origin.y = { value: 50, unit: '%' };
      } else if (!this.isYAxisKeyword(firstVal)) {
        // Single x-axis value defaults y to 50% (center)
        // This matches CSS behavior where "transform-origin: 100px" means "100px 50%"
        origin.y = { value: 50, unit: '%' };
      }
    }

    node.transform.transformOrigin = origin;
  }

  private isYAxisKeyword(value: Value): boolean {
    return isKeywordValue(value) && (value.value === 'top' || value.value === 'bottom');
  }

  private parseTransformOriginValue(value: Value, axis: 'x' | 'y'): TransformOriginValue | null {
    if (isKeywordValue(value)) {
      return this.keywordToOriginValue(value.value, axis);
    } else if (isLengthValue(value)) {
      if (value.unit === '%') {
        return { value: value.value, unit: '%' };
      } else {
        // Convert all other units to px (simplified)
        return { value: value.value, unit: 'px' };
      }
    } else if (isNumberValue(value)) {
      // Plain numbers treated as pixels
      return { value: value.value, unit: 'px' };
    }
    return null;
  }

  private keywordToOriginValue(keyword: string, _axis: 'x' | 'y'): TransformOriginValue {
    switch (keyword) {
      case 'left':
        return { value: 0, unit: '%' };
      case 'right':
        return { value: 100, unit: '%' };
      case 'top':
        return { value: 0, unit: '%' };
      case 'bottom':
        return { value: 100, unit: '%' };
      case 'center':
        return { value: 50, unit: '%' };
      default:
        // Unknown keyword defaults to 0
        return { value: 0, unit: 'px' };
    }
  }

  /**
   * Compose the `animation` shorthand and the `animation-*` longhands into the
   * node's animation instances, following CSS: declarations apply in source
   * order and later ones win per sub-property. The shorthand is a comma list of
   * independent animations (one instance each); a longhand is a comma list
   * indexed positionally against them, shorter lists cycling. The shorthand
   * resets the whole list; a longhand mutates only its own sub-property.
   */
  private resolveAnimations(node: SceneNode, declarations: Declaration[]): void {
    let slots: AnimSlot[] | null = null;
    // Grow (creating default slots) so a longhand seen before any shorthand can
    // still define animations positionally.
    const ensure = (n: number): AnimSlot[] => {
      slots ??= [];
      while (slots.length < n) slots.push(defaultAnimSlot());
      return slots;
    };
    const eachSlot = (v: Value, fn: (slot: AnimSlot, val: Value) => void): void => {
      const vals = commaValues(v);
      const s = ensure(vals.length);
      for (let i = 0; i < s.length; i++) fn(s[i], vals[i % vals.length]);
    };

    for (const decl of declarations) {
      switch (decl.property) {
        case 'animation': {
          // Shorthand resets the whole animation list.
          const groups = isListValue(decl.value) && decl.value.separator === 'comma'
            ? decl.value.values : [decl.value];
          slots = groups.map((g) => this.parseAnimationGroup(isListValue(g) ? g.values : [g]));
          break;
        }
        case 'animation-name':
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) || isStringValue(v)) slot.name = v.value;
          });
          break;
        case 'animation-duration':
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) { slot.duration = ms; slot.durationSet = true; }
          });
          break;
        case 'animation-delay':
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) slot.delay = ms;
          });
          break;
        case 'animation-timing-function':
          eachSlot(decl.value, (slot, v) => { slot.timingFunction = this.timingFromValue(v); });
          break;
        case 'animation-iteration-count':
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) && v.value === 'infinite') slot.iterationCount = Infinity;
            else if (isNumberValue(v)) slot.iterationCount = v.value;
          });
          break;
        case 'animation-direction':
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) && (v.value === 'normal' || v.value === 'reverse' || v.value === 'alternate' || v.value === 'alternate-reverse')) {
              slot.direction = v.value;
            }
          });
          break;
        case 'animation-fill-mode':
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) && (v.value === 'none' || v.value === 'forwards' || v.value === 'backwards' || v.value === 'both')) {
              slot.fillMode = v.value;
            }
          });
          break;
        // Not part of the `animation` shorthand (which resets it to 'replace').
        case 'animation-composition':
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) && (v.value === 'replace' || v.value === 'add' || v.value === 'accumulate')) {
              slot.composition = v.value;
            }
          });
          break;
      }
    }

    if (!slots) return;
    for (const slot of slots) {
      if (slot.name && this.keyframesMap.has(slot.name)) {
        node.animations.push({
          name: slot.name,
          duration: slot.duration,
          timingFunction: slot.timingFunction,
          iterationCount: slot.iterationCount,
          direction: slot.direction,
          delay: slot.delay,
          fillMode: slot.fillMode,
          composition: slot.composition,
          keyframes: this.buildKeyframes(this.keyframesMap.get(slot.name)!),
        });
      }
    }
  }

  /**
   * Resolve the `transition` shorthand together with the `transition-*`
   * longhands (comma lists matched positionally, composing like the animation
   * longhands). Returns only specs with a positive duration — a zero-duration
   * transition is an instant change, i.e. no tween. `all` is the default
   * property.
   */
  private resolveTransitions(declarations: Declaration[]): TransitionSpec[] {
    let slots: TransSlot[] | null = null;
    const ensure = (n: number): TransSlot[] => {
      slots ??= [];
      while (slots.length < n) slots.push(defaultTransSlot());
      return slots;
    };
    const eachSlot = (v: Value, fn: (slot: TransSlot, val: Value) => void): void => {
      const vals = commaValues(v);
      const s = ensure(vals.length);
      for (let i = 0; i < s.length; i++) fn(s[i], vals[i % vals.length]);
    };

    for (const decl of declarations) {
      switch (decl.property) {
        case 'transition': {
          const groups = isListValue(decl.value) && decl.value.separator === 'comma'
            ? decl.value.values : [decl.value];
          slots = groups.map((g) => this.parseTransitionGroup(isListValue(g) ? g.values : [g]));
          break;
        }
        case 'transition-property':
          eachSlot(decl.value, (slot, v) => { if (isKeywordValue(v)) slot.property = v.value; });
          break;
        case 'transition-duration':
          eachSlot(decl.value, (slot, v) => { const ms = timeMs(v); if (ms !== null) slot.duration = ms; });
          break;
        case 'transition-delay':
          eachSlot(decl.value, (slot, v) => { const ms = timeMs(v); if (ms !== null) slot.delay = ms; });
          break;
        case 'transition-timing-function':
          eachSlot(decl.value, (slot, v) => { slot.easing = this.timingFromValue(v); });
          break;
      }
    }

    if (!slots) return [];
    return slots
      .filter((s) => s.duration > 0)
      .map((s) => ({ property: s.property, duration: s.duration, easing: s.easing, delay: s.delay }));
  }

  /** Parse one `transition` shorthand group: `<property> <dur> [<easing>] [<delay>]`. */
  private parseTransitionGroup(values: Value[]): TransSlot {
    const slot = defaultTransSlot();
    let durationSet = false;
    for (const v of values) {
      if (isLengthValue(v) && (v.unit === 's' || v.unit === 'ms')) {
        const ms = timeMs(v)!;
        if (!durationSet) { slot.duration = ms; durationSet = true; }
        else slot.delay = ms;
      } else if (isFunctionValue(v) && this.isTimingFunctionName(v.name)) {
        slot.easing = this.timingFromFunction(v);
      } else if (isKeywordValue(v)) {
        const kw = v.value;
        if (kw === 'linear' || kw === 'ease' || kw === 'ease-in' || kw === 'ease-out' || kw === 'ease-in-out' || kw === 'step-start' || kw === 'step-end') {
          slot.easing = kw;
        } else {
          slot.property = kw; // property name: all/fill/stroke/stroke-width/opacity/transform
        }
      }
    }
    return slot;
  }

  /** Parse one `animation` shorthand group (space-separated) into a slot. */
  private parseAnimationGroup(values: Value[]): AnimSlot {
    const slot = defaultAnimSlot();
    for (const v of values) {
      if (isKeywordValue(v)) {
        const kw = v.value;
        if (this.keyframesMap.has(kw)) slot.name = kw;
        else if (kw === 'linear' || kw === 'ease' || kw === 'ease-in' || kw === 'ease-out' || kw === 'ease-in-out' || kw === 'step-start' || kw === 'step-end') slot.timingFunction = kw;
        else if (kw === 'infinite') slot.iterationCount = Infinity;
        else if (kw === 'normal' || kw === 'reverse' || kw === 'alternate' || kw === 'alternate-reverse') slot.direction = kw;
        else if (kw === 'none' || kw === 'forwards' || kw === 'backwards' || kw === 'both') slot.fillMode = kw;
      } else if (isFunctionValue(v) && this.isTimingFunctionName(v.name)) {
        slot.timingFunction = this.timingFromFunction(v);
      } else if (isLengthValue(v)) {
        // Time values are assigned by order (CSS rule): first duration, second delay.
        const ms = timeMs(v);
        if (ms !== null) {
          if (!slot.durationSet) { slot.duration = ms; slot.durationSet = true; }
          else slot.delay = ms;
        }
      } else if (isNumberValue(v)) {
        if (v.value === Math.floor(v.value) && v.value > 0 && v.value < 100) slot.iterationCount = v.value;
      } else if (isStringValue(v)) {
        slot.name = v.value;
      }
    }
    return slot;
  }

  private isTimingFunctionName(name: string): boolean {
    return name === 'cubic-bezier' || name === 'steps' || name === 'linear';
  }

  /** Resolve a timing-function FunctionValue (cubic-bezier(), steps(), linear()). */
  private timingFromFunction(v: FunctionValue): TimingFunction {
    if (v.name === 'cubic-bezier') return this.parseCubicBezierFunction(v);
    if (v.name === 'steps') return this.parseStepsFunction(v);
    if (v.name === 'linear') return this.parseLinearFunction(v);
    return 'ease';
  }

  /**
   * Parse `linear(<stop-list>)` (CSS Easing L2). The parser flattens the args,
   * so each `<number>` starts a control point (its output) and the following
   * `<percentage>` lengths are that point's input position(s) — two percentages
   * expand to two points sharing the output (a flat segment). Missing inputs are
   * distributed per spec (see normalizeLinearPoints). Degenerate lists fall back
   * to the plain `linear` keyword.
   */
  private parseLinearFunction(func: FunctionValue): TimingFunction {
    const raw: { output: number; inputs: number[] }[] = [];
    for (const arg of func.args) {
      if (isNumberValue(arg)) raw.push({ output: arg.value, inputs: [] });
      else if (isLengthValue(arg) && arg.unit === '%' && raw.length > 0) {
        raw[raw.length - 1].inputs.push(arg.value / 100);
      }
    }
    const pts: { input: number | null; output: number }[] = [];
    for (const s of raw) {
      if (s.inputs.length === 0) pts.push({ input: null, output: s.output });
      else for (const input of s.inputs) pts.push({ input, output: s.output });
    }
    const points = normalizeLinearPoints(pts);
    if (points.length < 2) return 'linear';
    return { type: 'linear', points };
  }

  /**
   * Parse `steps(<count>, <position>?)`. Position defaults to jump-end; the CSS
   * `start`/`end` aliases map to jump-start/jump-end. The parser flattens the
   * function args, so they arrive as [<number count>, <keyword position>?].
   */
  private parseStepsFunction(func: FunctionValue): TimingFunction {
    let count = 1;
    let position: StepPosition = 'jump-end';
    for (const arg of func.args) {
      if (isNumberValue(arg)) count = Math.max(1, Math.round(arg.value));
      else if (isKeywordValue(arg)) {
        const p = arg.value;
        if (p === 'start') position = 'jump-start';
        else if (p === 'end') position = 'jump-end';
        else if (p === 'jump-start' || p === 'jump-end' || p === 'jump-none' || p === 'jump-both') position = p;
      }
    }
    return { type: 'steps', count, position };
  }

  /**
   * Resolve any timing-function value (named keyword or a function). One path
   * shared by the `animation` shorthand, the `animation-timing-function`
   * longhand, and per-keyframe easing, so the DSL accepts the same easing syntax
   * everywhere.
   */
  private timingFromValue(v: Value): TimingFunction {
    if (isFunctionValue(v) && this.isTimingFunctionName(v.name)) return this.timingFromFunction(v);
    if (isKeywordValue(v) && (v.value === 'linear' || v.value === 'ease' || v.value === 'ease-in' || v.value === 'ease-out' || v.value === 'ease-in-out' || v.value === 'step-start' || v.value === 'step-end')) {
      return v.value;
    }
    return 'ease';
  }

  private buildKeyframes(rule: KeyframeRule): KeyframeData[] {
    const frames = rule.blocks.map(block => {
      const keyframeData: KeyframeData = {
        offset: block.selectors[0] / 100, // Convert percentage to 0-1
        properties: this.buildKeyframeProperties(block),
      };

      // Add per-keyframe easing if specified (resolved through the one shared
      // timing-function path, so keyframes accept the same easing syntax as the
      // animation shorthand/longhand).
      if (block.easing) {
        keyframeData.easing = this.timingFromValue(block.easing);
      }

      return keyframeData;
    });
    // Author order isn't guaranteed ascending (`100% {} 0% {}` is legal CSS);
    // sort once here so per-frame sampling can trust the order.
    frames.sort((a, b) => a.offset - b.offset);
    warnIncompatibleObjectKeyframes(rule.name, frames);
    return frames;
  }

  private buildKeyframeProperties(block: KeyframeBlock): Record<string, AnimatableValue> {
    const props: Record<string, AnimatableValue> = {};

    for (const decl of block.declarations) {
      const { property, value } = decl;

      switch (property) {
        case 'transform':
          // Store individual transform properties instead of full Transform
          // This allows merging with base transform during interpolation
          this.extractTransformProperties(value, props);
          break;
        case 'translate':
        case 'rotate':
        case 'scale':
          // CSS individual transform properties animate the same channels.
          extractIndividualTransform(property, value, (key, val) => { props[key] = val; });
          break;
        case 'opacity':
          props.opacity = getNumericValue(value);
          break;
        case 'trim-start':
        case 'trim-end':
        case 'trim-offset':
        case 'offset-distance':
          // Store normalized 0..1 so keyframe interpolation stays in range.
          props[property] = normalizeFraction(value);
          break;
        case 'fill':
        case 'stroke': {
          // A gradient endpoint parses to structured GradientData (animated
          // stops); a plain color parses to its string. Both are animatable.
          const paint = this.parsePaint(value);
          if (paint?.type === 'gradient') {
            if (paint.gradient) props[property] = paint.gradient;
          } else if (paint?.color != null) {
            props[property] = paint.color;
          }
          break;
        }
        case 'd':
          // Path morphing: parse the path string to commands once at build.
          props.d = parsePath(getStringValue(value));
          break;
        case 'clip-path': {
          // Animated clip (Lottie animated masks): only the path() variant
          // morphs — reuse parseClipPath, then carry its command list as the
          // path-kind keyframe value (circle/inset aren't command-morphable).
          const clip = this.parseClipPath(value);
          if (clip && clip.type === 'path') props['clip-path'] = clip.commands;
          break;
        }
        default:
          // Store raw numeric/string value
          if (isNumberValue(value) || isLengthValue(value)) {
            props[property] = getNumericValue(value);
          } else if (isColorValue(value) || isKeywordValue(value) || isStringValue(value)) {
            props[property] = getStringValue(value);
          }
      }
    }

    return props;
  }

  private extractTransformProperties(value: Value, props: Record<string, AnimatableValue>): void {
    // Extract individual transform functions into separate properties so they
    // merge with the base transform during animation.
    extractTransform(value, (key, val) => {
      props[key] = val;
    });
  }

  /**
   * Parse a linear-gradient()/radial-gradient() function value into a structured
   * GradientData. The parser flattens the CSS syntax into a bare arg list, e.g.
   *   linear-gradient(45deg, #f00 0%, #00f 100%)
   *     -> [45deg, #f00, 0%, #00f, 100%]
   * so we walk it: an optional leading angle (linear only), then color/stop
   * pairs where the stop percentage is optional. Returns null if no usable
   * color stops are found (caller falls back to no fill/stroke).
   */
  /**
   * Resolve a fill/stroke paint value: gradient function -> structured
   * GradientData (null when invalid), color/keyword/rgb() -> color string
   * ('none' -> null). Returns null for values that aren't paints at all.
   * Shared by declaration and keyframe paths.
   */
  private parsePaint(
    value: Value
  ): { type: 'gradient'; gradient: GradientData | null } | { type: 'color'; color: string | null } | null {
    if (isFunctionValue(value) && (value.name === 'linear-gradient' || value.name === 'radial-gradient')) {
      return { type: 'gradient', gradient: this.parseGradient(value) };
    }
    if (isColorValue(value)) {
      return { type: 'color', color: value.value };
    }
    if (isKeywordValue(value)) {
      return { type: 'color', color: value.value === 'none' ? null : value.value };
    }
    if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
      return { type: 'color', color: this.buildColorString(value) };
    }
    return null;
  }

  private parseGradient(func: { name: string; args: Value[] }): GradientData | null {
    const isLinear = func.name === 'linear-gradient';
    const args = func.args;
    let i = 0;

    // CSS default gradient direction is `to bottom` (180deg).
    let angle = 180;
    if (isLinear && args.length > 0 && isLengthValue(args[0]) && args[0].unit === 'deg') {
      angle = args[0].value;
      i = 1;
    }

    // Explicit geometry keywords lead the arg list (from the Lottie converter):
    //   linear-gradient(from <x>px <y>px to <x>px <y>px, stops...)
    //   radial-gradient(circle <r>px at <cx>px <cy>px [from <fx>px <fy>px], stops...)
    // Coordinates are in the shape's local space; `from` is endpoint for linear,
    // focal (inner-circle center) for radial.
    const num = (v?: Value): number | null =>
      v && (isLengthValue(v) || isNumberValue(v)) ? v.value : null;
    let from: { x: number; y: number } | undefined;
    let to: { x: number; y: number } | undefined;
    let radius: number | undefined;
    let at: { x: number; y: number } | undefined;
    let focal: { x: number; y: number } | undefined;
    while (i < args.length && isKeywordValue(args[i])) {
      const kw = (args[i] as { value: string }).value;
      const x = num(args[i + 1]);
      if (kw === 'circle' && x != null) { radius = x; i += 2; continue; }
      const y = num(args[i + 2]);
      if (kw === 'at' && x != null && y != null) { at = { x, y }; i += 3; continue; }
      if (kw === 'to' && x != null && y != null) { to = { x, y }; i += 3; continue; }
      if (kw === 'from' && x != null && y != null) {
        if (isLinear) from = { x, y }; else focal = { x, y };
        i += 3; continue;
      }
      break; // unknown keyword — leave it for the stop loop to skip
    }

    const stops: GradientStop[] = [];
    while (i < args.length) {
      const color = this.colorArgToString(args[i++]);
      if (color === null) continue; // skip anything that isn't a color
      let offset: number | null = null;
      const next = args[i];
      if (next && isLengthValue(next) && next.unit === '%') {
        offset = next.value / 100;
        i++;
      }
      stops.push({ color, offset: offset ?? -1 });
    }

    if (stops.length === 0) return null;

    // Fill in any omitted stop offsets by even distribution.
    const n = stops.length;
    for (let k = 0; k < n; k++) {
      if (stops[k].offset < 0) {
        stops[k].offset = n === 1 ? 0 : k / (n - 1);
      }
    }

    return isLinear
      ? { type: 'linear-gradient', angle, stops, from, to }
      : { type: 'radial-gradient', stops, radius, at, focal };
  }

  private colorArgToString(value: Value): string | null {
    if (isColorValue(value)) return value.value;
    if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
      return this.buildColorString(value);
    }
    return null;
  }

  /**
   * Parse a clip-path value:
   *   circle(<r>px at <x>px <y>px) | inset(<t> <r> <b> <l>) | path('<d>')
   * Returns null for anything unrecognized (node stays unclipped).
   */
  private parseClipPath(value: Value): ClipPathData | null {
    // Multiple space-separated path() values union into one clip region (Lottie
    // mask add-mode). Concatenating the subpaths into a single command list is
    // enough: Path2D + a nonzero fill treats them as one shape, so we clip once
    // and hit-testing passes for a point inside any of them.
    if (isListValue(value)) {
      const commands: PathCommand[] = [];
      for (const v of value.values) {
        if (isFunctionValue(v) && v.name === 'path') {
          const arg = v.args[0];
          if (arg && isStringValue(arg)) commands.push(...parsePath(arg.value));
        }
      }
      return commands.length > 0 ? { type: 'path', commands } : null;
    }

    if (!isFunctionValue(value)) return null;

    if (value.name === 'circle') {
      // Args: [r, keyword 'at', x, y] — collect the numeric ones in order.
      const nums = value.args.filter(a => isLengthValue(a) || isNumberValue(a)).map(getNumericValue);
      if (nums.length === 0) return null;
      return { type: 'circle', r: nums[0], x: nums[1] ?? 0, y: nums[2] ?? 0 };
    }

    if (value.name === 'inset') {
      const nums = value.args.filter(a => isLengthValue(a) || isNumberValue(a)).map(getNumericValue);
      if (nums.length === 0) return null;
      // CSS shorthand: 1 -> all, 2 -> (t/b, l/r), 4 -> t r b l.
      const top = nums[0];
      const right = nums[1] ?? top;
      const bottom = nums[2] ?? top;
      const left = nums[3] ?? right;
      return { type: 'inset', top, right, bottom, left };
    }

    if (value.name === 'path') {
      const arg = value.args[0];
      if (arg && isStringValue(arg)) {
        return { type: 'path', commands: parsePath(arg.value) };
      }
    }

    return null;
  }

  /**
   * Parse `mask: #<id> alpha | alpha-invert | luminance | luminance-invert`. The id is
   * carried as a `#`-prefixed keyword by the parser; the mode defaults to alpha.
   * Resolution to the source node happens once the whole tree exists.
   */
  private parseMask(node: SceneNode, value: Value): void {
    const values = isListValue(value) ? value.values : [value];
    let sourceId: string | null = null;
    let mode: MaskMode = 'alpha';
    for (const v of values) {
      if (!isKeywordValue(v)) continue;
      if (v.value.startsWith('#')) {
        sourceId = v.value.slice(1);
      } else if (v.value === 'alpha' || v.value === 'alpha-invert' || v.value === 'luminance' || v.value === 'luminance-invert') {
        mode = v.value;
      }
    }
    if (sourceId) this.pendingMasks.push({ node, sourceId, mode });
  }

  /**
   * Parse offset-rotate: `auto | <angle>deg | auto <angle>deg` (CSS Motion
   * Path). Default (and bare `auto`) follows the tangent; a lone angle is a
   * fixed orientation; `auto <angle>` is tangent plus a fixed offset.
   */
  private parseOffsetRotate(value: Value): { auto: boolean; angle: number } {
    const values = isListValue(value) ? value.values : [value];
    let auto = false;
    let angle = 0;
    let sawAuto = false;
    let sawAngle = false;
    for (const v of values) {
      if (isKeywordValue(v) && v.value === 'auto') {
        auto = true;
        sawAuto = true;
      } else if (isLengthValue(v) || isNumberValue(v)) {
        angle = getNumericValue(v);
        sawAngle = true;
      }
    }
    // Nothing recognized -> CSS default `auto`.
    if (!sawAuto && !sawAngle) auto = true;
    return { auto, angle };
  }

  private buildColorString(func: { name: string; args: Value[] }): string {
    if (func.name === 'rgb') {
      const r = getNumericValue(func.args[0]);
      const g = getNumericValue(func.args[1]);
      const b = getNumericValue(func.args[2]);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (func.name === 'rgba') {
      const r = getNumericValue(func.args[0]);
      const g = getNumericValue(func.args[1]);
      const b = getNumericValue(func.args[2]);
      const a = getNumericValue(func.args[3]);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return '#000000';
  }

  private hasVariableReference(value: Value): boolean {
    // Check if the value is a variable reference (var())
    if (isVariableRefValue(value)) {
      return true;
    }

    // Check if it's an input() function
    if (isFunctionValue(value) && value.name === 'input') {
      return true;
    }

    // Check list values recursively
    if (isListValue(value)) {
      return value.values.some(v => this.hasVariableReference(v));
    }

    return false;
  }

  /**
   * Parse a cubic-bezier FunctionValue into a CubicBezier timing function
   */
  /**
   * Parse a `time-remap` value into sorted stops. The value is a comma list of
   * stops, each a space list `<input-time> <output-time> [easing]` (times in
   * s/ms; easing is a cubic-bezier()/step-end/named curve governing the segment
   * to the next stop, departing-keyframe convention). A single bare stop is
   * accepted too. Returns null when nothing usable was found.
   */
  private parseTimeRemap(value: Value): TimeRemapStop[] | null {
    const items = isListValue(value) && value.separator === 'comma'
      ? value.values
      : [value];
    const stops: TimeRemapStop[] = [];
    for (const item of items) {
      const parts = isListValue(item) ? item.values : [item];
      let input: number | null = null;
      let output: number | null = null;
      let easing: TimingFunction | undefined;
      for (const p of parts) {
        if (isLengthValue(p) && (p.unit === 's' || p.unit === 'ms')) {
          const ms = p.unit === 's' ? p.value * 1000 : p.value;
          if (input === null) input = ms;
          else if (output === null) output = ms;
        } else if (isNumberValue(p)) {
          const ms = p.value; // bare number = ms
          if (input === null) input = ms;
          else if (output === null) output = ms;
        } else if (isFunctionValue(p) && p.name === 'cubic-bezier') {
          easing = this.parseCubicBezierFunction(p);
        } else if (isKeywordValue(p) && p.value === 'step-end') {
          easing = 'step-end';
        } else if (isKeywordValue(p) && (
          p.value === 'linear' || p.value === 'ease' || p.value === 'ease-in' ||
          p.value === 'ease-out' || p.value === 'ease-in-out')) {
          easing = p.value;
        }
      }
      if (input !== null && output !== null) stops.push({ input, output, easing });
    }
    if (stops.length === 0) return null;
    stops.sort((a, b) => a.input - b.input);
    return stops;
  }

  private parseCubicBezierFunction(func: { name: string; args: Value[] }): TimingFunction {
    if (func.args.length >= 4) {
      return {
        type: 'cubic-bezier',
        x1: getNumericValue(func.args[0]),
        y1: getNumericValue(func.args[1]),
        x2: getNumericValue(func.args[2]),
        y2: getNumericValue(func.args[3]),
      };
    }
    return 'ease';
  }
}

export function buildSceneGraph(stylesheet: StyleSheet): SceneNode {
  const builder = new SceneBuilder();
  return builder.build(stylesheet);
}

// Deep-clone a definition child rule, namespacing every id in the subtree under
// the instance's id (e.g. `tail` under `spark1` -> `spark1.tail`) so multiple
// instances of the same symbol never share scene-node ids.
function namespaceChild(rule: Rule, prefix: string): Rule {
  const name = `${prefix}.${rule.selector.name}`;
  return {
    type: 'rule',
    selector: { ...rule.selector, name },
    declarations: rule.declarations, // values are read-only during build
    children: rule.children.map((c) => namespaceChild(c, name)),
    states: rule.states,
  };
}

// Merge state blocks: a use-site block replaces the definition's for the same pseudo.
function mergeStates(defStates: StateRule[], useStates: StateRule[]): StateRule[] {
  const byPseudo = new Map<string, StateRule>();
  for (const s of defStates) byPseudo.set(s.state, s);
  for (const s of useStates) byPseudo.set(s.state, s);
  return [...byPseudo.values()];
}

// Distribute missing input positions of a linear() control-point list per the
// CSS Easing L2 algorithm: the first/last default to the domain edges (0/1),
// each defined input is clamped non-decreasing, then runs of missing inputs are
// filled by linear interpolation between their bounding neighbours. Mutates and
// returns the list (inputs now all defined, ascending).
function normalizeLinearPoints(pts: { input: number | null; output: number }[]): LinearEasingPoint[] {
  const n = pts.length;
  if (n === 0) return [];
  if (pts[0].input == null) pts[0].input = 0;
  if (pts[n - 1].input == null) pts[n - 1].input = 1;
  let largest = pts[0].input as number;
  for (const p of pts) {
    if (p.input != null) { largest = Math.max(largest, p.input); p.input = largest; }
  }
  let i = 0;
  while (i < n) {
    if (pts[i].input == null) {
      let j = i;
      while (j < n && pts[j].input == null) j++;
      const prev = pts[i - 1].input as number;
      const next = pts[j].input as number;
      const span = j - i + 1;
      for (let k = i; k < j; k++) pts[k].input = prev + ((next - prev) * (k - i + 1)) / span;
      i = j;
    } else i++;
  }
  return pts as LinearEasingPoint[];
}

// A percentage (50%) becomes 0.5; a bare number (0.5) is taken as-is. Used for
// trim-* props, which are fractions of the outline length.
function normalizeFraction(value: Value): number {
  if (isLengthValue(value) && value.unit === '%') return value.value / 100;
  return getNumericValue(value);
}

// Accumulated state for one animation while composing the `animation` shorthand
// with the `animation-*` longhands (see resolveAnimations).
interface AnimSlot {
  name: string;
  duration: number;
  durationSet: boolean;
  timingFunction: TimingFunction;
  iterationCount: number;
  direction: AnimationDirection;
  delay: number;
  fillMode: AnimationFillMode;
  composition: CompositeOperation;
}

// Accumulated state for one transition while composing the `transition`
// shorthand with the `transition-*` longhands (see resolveTransitions).
interface TransSlot {
  property: string;
  duration: number;
  easing: TimingFunction;
  delay: number;
}

// CSS transition initial values: property `all`, duration 0, `ease`, delay 0.
function defaultTransSlot(): TransSlot {
  return { property: 'all', duration: 0, easing: 'ease', delay: 0 };
}

// fill-mode defaults to 'forwards' (not CSS's 'none') so scenes hold their final
// frame; every other field is the CSS initial value.
function defaultAnimSlot(): AnimSlot {
  return {
    name: '', duration: 1000, durationSet: false, timingFunction: 'ease',
    iterationCount: 1, direction: 'normal', delay: 0, fillMode: 'forwards',
    composition: 'replace',
  };
}

// A comma-separated animation longhand splits into per-animation values; a bare
// value is a single-element list.
function commaValues(value: Value): Value[] {
  return isListValue(value) && value.separator === 'comma' ? value.values : [value];
}

// Time value (`s`/`ms`) to milliseconds, or null when it isn't a time.
function timeMs(value: Value): number | null {
  if (!isLengthValue(value)) return null;
  return value.unit === 's' ? value.value * 1000 : value.unit === 'ms' ? value.value : null;
}
