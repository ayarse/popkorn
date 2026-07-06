import type { StyleSheet, Rule, Declaration, Value, KeyframeRule, KeyframeBlock, StateRule, DefinitionRule } from '@popcorn/parser';
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
  TimingFunction,
  AnimationDirection,
  AnimationFillMode,
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
  ClipPathData,
} from './types';
import type { GradientData, GradientStop } from '../renderer/types';
import { createSceneNode, createDefaultTransformOrigin, snapshotNode } from './types';
import { parsePath, buildMotionPath } from './path-parser';

const isPolystar = (sd: ShapeData): sd is PolystarData =>
  sd.type === 'star' || sd.type === 'polygon';

/**
 * Build scene graph from AST
 */
export class SceneBuilder {
  private keyframesMap: Map<string, KeyframeRule> = new Map();
  private definitionsMap: Map<string, DefinitionRule> = new Map();
  // Longhand animation-fill-mode for the node currently being built (it
  // overrides any value in the animation shorthand, regardless of source order).
  private pendingFillMode: AnimationFillMode | null = null;

  build(stylesheet: StyleSheet): SceneNode {
    // Index keyframes and symbol definitions by name
    for (const kf of stylesheet.keyframes) {
      this.keyframesMap.set(kf.name, kf);
    }
    for (const def of stylesheet.definitions) {
      this.definitionsMap.set(def.name, def);
    }

    // Create root node
    const root = createSceneNode('root', 'group');

    // Process rules
    for (const rule of stylesheet.rules) {
      const node = this.buildNode(rule);
      node.parent = root;
      root.children.push(node);
    }

    return root;
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

    // Pre-scan the longhand animation-fill-mode so it wins over the shorthand.
    this.pendingFillMode = this.findFillMode(rule.declarations);

    // Apply declarations
    this.applyDeclarations(node, rule.declarations);

    this.pendingFillMode = null;

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
          styles.transform = this.extractStateTransform(value);
          break;
      }
    }

    return styles;
  }

  /**
   * Extract transform properties from a transform value for state styles
   */
  private extractStateTransform(value: Value): Partial<Transform> {
    const transform: Partial<Transform> = {};

    const extractSingle = (funcValue: { name: string; args: Value[] }) => {
      switch (funcValue.name) {
        case 'translate':
          transform.translateX = getNumericValue(funcValue.args[0]);
          transform.translateY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : 0;
          break;
        case 'translateX':
          transform.translateX = getNumericValue(funcValue.args[0]);
          break;
        case 'translateY':
          transform.translateY = getNumericValue(funcValue.args[0]);
          break;
        case 'rotate':
          transform.rotate = getNumericValue(funcValue.args[0]);
          break;
        case 'scale':
          transform.scaleX = getNumericValue(funcValue.args[0]);
          transform.scaleY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : transform.scaleX;
          break;
        case 'scaleX':
          transform.scaleX = getNumericValue(funcValue.args[0]);
          break;
        case 'scaleY':
          transform.scaleY = getNumericValue(funcValue.args[0]);
          break;
      }
    };

    if (isFunctionValue(value)) {
      extractSingle(value);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          extractSingle(v);
        }
      }
    }

    return transform;
  }

  private findFillMode(declarations: Declaration[]): AnimationFillMode | null {
    for (const decl of declarations) {
      if (decl.property === 'animation-fill-mode' && isKeywordValue(decl.value)) {
        const kw = decl.value.value;
        if (kw === 'none' || kw === 'forwards' || kw === 'backwards' || kw === 'both') {
          return kw;
        }
      }
    }
    return null;
  }

  private applyDeclarations(node: SceneNode, declarations: Declaration[]): void {
    for (const decl of declarations) {
      this.applyDeclaration(node, decl);
    }
  }

  private applyDeclaration(node: SceneNode, decl: Declaration): void {
    const { property, value } = decl;

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

      case 'transform-origin':
        this.applyTransformOrigin(node, value);
        break;

      // Position/size for rect (x/y are also the text anchor point)
      case 'x':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).x = getNumericValue(value);
        } else if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).x = getNumericValue(value);
        }
        break;
      case 'y':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).y = getNumericValue(value);
        } else if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).y = getNumericValue(value);
        }
        break;

      // Text
      case 'content':
        if (node.shapeData.type === 'text') {
          (node.shapeData as TextData).content = getStringValue(value);
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
        }
        break;
      case 'height':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).height = getNumericValue(value);
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

      // Star / polygon geometry. Synthesized into a path at render time; `points`
      // is static, the rest are animatable (see the registry).
      case 'points':
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).points = getNumericValue(value);
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
      case 'fill':
        if (isFunctionValue(value) && (value.name === 'linear-gradient' || value.name === 'radial-gradient')) {
          const grad = this.parseGradient(value);
          // Invalid gradient falls back to no fill (solid color path below is
          // never reached for a function value).
          node.fillGradient = grad;
          node.fill = null;
        } else if (isColorValue(value)) {
          node.fill = value.value;
        } else if (isKeywordValue(value)) {
          if (value.value === 'none') {
            node.fill = null;
          } else {
            node.fill = value.value;
          }
        } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
          node.fill = this.buildColorString(value);
        }
        break;

      case 'stroke':
        if (isFunctionValue(value) && (value.name === 'linear-gradient' || value.name === 'radial-gradient')) {
          node.strokeGradient = this.parseGradient(value);
          node.stroke = null;
        } else if (isColorValue(value)) {
          node.stroke = value.value;
        } else if (isKeywordValue(value)) {
          if (value.value === 'none') {
            node.stroke = null;
          } else {
            node.stroke = value.value;
          }
        } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
          node.stroke = this.buildColorString(value);
        }
        break;

      case 'clip-path':
        node.clipPath = this.parseClipPath(value);
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

      // Animation (shorthand)
      case 'animation':
        this.applyAnimation(node, value);
        break;

      case 'animation-name':
        // Will be combined with other animation properties
        break;
      case 'animation-duration':
        break;
      case 'animation-timing-function':
        break;
      case 'animation-iteration-count':
        break;
      case 'animation-direction':
        break;
      case 'animation-delay':
        break;
      case 'animation-fill-mode':
        // Handled by the pre-scan in buildNode (see pendingFillMode).
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
            points: 5, outerRadius: 0, innerRadius: 0, rotation: 0,
            cx: 0, cy: 0, outerRoundness: 0, innerRoundness: 0,
          };
          break;
        case 'text':
          node.shapeData = {
            type: 'text', x: 0, y: 0, content: '',
            fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'normal', anchor: 'start',
          };
          break;
      }
    }
  }

  private applyTransform(node: SceneNode, value: Value): void {
    if (isFunctionValue(value)) {
      this.applySingleTransform(node.transform, value.name, value.args);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          this.applySingleTransform(node.transform, v.name, v.args);
        }
      }
    }
  }

  private applySingleTransform(transform: Transform, name: string, args: Value[]): void {
    switch (name) {
      case 'translate':
        transform.translateX = getNumericValue(args[0]);
        transform.translateY = args.length > 1 ? getNumericValue(args[1]) : 0;
        break;
      case 'translateX':
        transform.translateX = getNumericValue(args[0]);
        break;
      case 'translateY':
        transform.translateY = getNumericValue(args[0]);
        break;
      case 'rotate':
        transform.rotate = getNumericValue(args[0]);
        break;
      case 'scale':
        transform.scaleX = getNumericValue(args[0]);
        transform.scaleY = args.length > 1 ? getNumericValue(args[1]) : transform.scaleX;
        break;
      case 'scaleX':
        transform.scaleX = getNumericValue(args[0]);
        break;
      case 'scaleY':
        transform.scaleY = getNumericValue(args[0]);
        break;
    }
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

  private applyAnimation(node: SceneNode, value: Value): void {
    // Parse animation shorthand: name duration timing-function iteration-count direction
    let values: Value[] = [];
    if (isListValue(value)) {
      values = value.values;
    } else {
      values = [value];
    }

    let name = '';
    let duration = 1000;
    let durationSet = false;
    let timingFunction: TimingFunction = 'ease';
    let iterationCount = 1;
    let direction: AnimationDirection = 'normal';
    let delay = 0;
    // CSS default is 'none', but existing examples rely on animations holding
    // their final frame after finishing, so we deliberately default to
    // 'forwards'. A longhand `animation-fill-mode` (below) still overrides it.
    let fillMode: AnimationFillMode = this.pendingFillMode ?? 'forwards';

    for (const v of values) {
      if (isKeywordValue(v)) {
        const kw = v.value;
        if (this.keyframesMap.has(kw)) {
          name = kw;
        } else if (kw === 'linear' || kw === 'ease' || kw === 'ease-in' || kw === 'ease-out' || kw === 'ease-in-out' || kw === 'step-end') {
          timingFunction = kw;
        } else if (kw === 'hold') {
          timingFunction = 'step-end';
        } else if (kw === 'infinite') {
          iterationCount = Infinity;
        } else if (kw === 'normal' || kw === 'reverse' || kw === 'alternate' || kw === 'alternate-reverse') {
          direction = kw;
        } else if (kw === 'none' || kw === 'forwards' || kw === 'backwards' || kw === 'both') {
          // A longhand animation-fill-mode still wins over the shorthand value.
          fillMode = this.pendingFillMode ?? kw;
        }
      } else if (isFunctionValue(v) && v.name === 'cubic-bezier') {
        // Handle cubic-bezier(x1, y1, x2, y2)
        timingFunction = this.parseCubicBezierFunction(v);
      } else if (isLengthValue(v)) {
        // Time values are assigned by order (CSS rule): the first is duration,
        // the second is delay — regardless of magnitude.
        const ms = v.unit === 's' ? v.value * 1000 : v.unit === 'ms' ? v.value : null;
        if (ms !== null) {
          if (!durationSet) {
            duration = ms;
            durationSet = true;
          } else {
            delay = ms;
          }
        }
      } else if (isNumberValue(v)) {
        // Could be iteration count or duration
        if (v.value === Math.floor(v.value) && v.value > 0 && v.value < 100) {
          iterationCount = v.value;
        }
      } else if (isStringValue(v)) {
        // Animation name as string
        name = v.value;
      }
    }

    if (name && this.keyframesMap.has(name)) {
      const keyframeRule = this.keyframesMap.get(name)!;
      const keyframes = this.buildKeyframes(keyframeRule);

      node.animations.push({
        name,
        duration,
        timingFunction,
        iterationCount,
        direction,
        delay,
        fillMode,
        keyframes,
      });
    }
  }

  private buildKeyframes(rule: KeyframeRule): KeyframeData[] {
    return rule.blocks.map(block => {
      const keyframeData: KeyframeData = {
        offset: block.selectors[0] / 100, // Convert percentage to 0-1
        properties: this.buildKeyframeProperties(block),
      };

      // Add per-keyframe easing if specified
      if (block.easing) {
        keyframeData.easing = this.parseTimingFunction(block.easing);
      }

      return keyframeData;
    });
  }

  private buildKeyframeProperties(block: KeyframeBlock): Record<string, number | string | Transform> {
    const props: Record<string, number | string | Transform> = {};

    for (const decl of block.declarations) {
      const { property, value } = decl;

      switch (property) {
        case 'transform':
          // Store individual transform properties instead of full Transform
          // This allows merging with base transform during interpolation
          this.extractTransformProperties(value, props);
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
          if (isColorValue(value)) {
            props.fill = value.value;
          } else if (isFunctionValue(value)) {
            props.fill = this.buildColorString(value);
          }
          break;
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

  private extractTransformProperties(value: Value, props: Record<string, number | string | Transform>): void {
    // Extract individual transform functions into separate properties
    // This allows proper merging with base transform during animation
    const extractSingle = (funcValue: { name: string; args: Value[] }) => {
      switch (funcValue.name) {
        case 'translate':
          props.translateX = getNumericValue(funcValue.args[0]);
          props.translateY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : 0;
          break;
        case 'translateX':
          props.translateX = getNumericValue(funcValue.args[0]);
          break;
        case 'translateY':
          props.translateY = getNumericValue(funcValue.args[0]);
          break;
        case 'rotate':
          props.rotate = getNumericValue(funcValue.args[0]);
          break;
        case 'scale':
          props.scaleX = getNumericValue(funcValue.args[0]);
          props.scaleY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : props.scaleX as number;
          break;
        case 'scaleX':
          props.scaleX = getNumericValue(funcValue.args[0]);
          break;
        case 'scaleY':
          props.scaleY = getNumericValue(funcValue.args[0]);
          break;
      }
    };

    if (isFunctionValue(value)) {
      extractSingle(value);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          extractSingle(v);
        }
      }
    }
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
      ? { type: 'linear-gradient', angle, stops }
      : { type: 'radial-gradient', stops };
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
   * Parse a timing function string into a TimingFunction type
   * Handles both named keywords and cubic-bezier() strings
   */
  private parseTimingFunction(easingStr: string): TimingFunction {
    // Check for named timing functions
    if (easingStr === 'linear' || easingStr === 'ease' ||
        easingStr === 'ease-in' || easingStr === 'ease-out' ||
        easingStr === 'ease-in-out' || easingStr === 'step-end') {
      return easingStr;
    }
    // `hold` is an alias for step-end (holds the departing keyframe's value).
    if (easingStr === 'hold') {
      return 'step-end';
    }

    // Check for cubic-bezier()
    const cubicBezierMatch = easingStr.match(/^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/);
    if (cubicBezierMatch) {
      return {
        type: 'cubic-bezier',
        x1: parseFloat(cubicBezierMatch[1]),
        y1: parseFloat(cubicBezierMatch[2]),
        x2: parseFloat(cubicBezierMatch[3]),
        y2: parseFloat(cubicBezierMatch[4]),
      };
    }

    // Default to ease
    return 'ease';
  }

  /**
   * Parse a cubic-bezier FunctionValue into a CubicBezier timing function
   */
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

// A percentage (50%) becomes 0.5; a bare number (0.5) is taken as-is. Used for
// trim-* props, which are fractions of the outline length.
function normalizeFraction(value: Value): number {
  if (isLengthValue(value) && value.unit === '%') return value.value / 100;
  return getNumericValue(value);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
