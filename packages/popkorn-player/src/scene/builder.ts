import type {
  CalcExpr,
  Declaration,
  DefinitionRule,
  FunctionValue,
  KeyframeBlock,
  KeyframeRule,
  MachineRule,
  Rule,
  Selector,
  StateRule,
  StyleSheet,
  Value,
} from "@popkorn/parser";
import {
  evalCalcStatic,
  getNumericValue,
  getStringValue,
  isCalcValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isStringValue,
  isVariableRefValue,
  serialize,
} from "@popkorn/parser";
import type { PropValue } from "../animation/registry";
import {
  getPropHandler,
  gradientsCompatible,
  pathsCompatible,
} from "../animation/registry";
import type {
  GradientData,
  GradientStop,
  PathCommand,
} from "../renderer/types";
import { isGradientData } from "../renderer/types";
import { colorStringFromValue } from "./color";
import { buildMotionPath, parsePath } from "./path-parser";
import { freezeRandom, hashString, valueHasRandom } from "./random";
import type { SiblingContext } from "./sibling";
import { foldSiblingFns, valueHasSiblingFn } from "./sibling";
import { clamp01 } from "./transform";
import type {
  AnimatableValue,
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  BlendMode,
  CircleData,
  ClipPathData,
  CompositeOperation,
  EllipseData,
  FilterOp,
  ImageData,
  ImageViewBox,
  KeyframeData,
  LinearEasingPoint,
  MaskMode,
  PathData,
  PolystarData,
  PropertyBinding,
  RectData,
  SceneNode,
  ShapeData,
  ShapeType,
  StateStyles,
  StepPosition,
  TextAnchor,
  TextData,
  TimeRemapStop,
  TimingFunction,
  Transform,
  TransformOriginValue,
  TransitionSpec,
} from "./types";
import {
  createDefaultTransformOrigin,
  createSceneNode,
  snapshotNode,
} from "./types";

// Declarations that are valid inside a state block but handled outside the
// buildStateStyles switch (transition* → resolveTransitions, animation* →
// buildAnimations for :state() blocks), so the default case must not warn.
const STATE_BLOCK_IGNORED = new Set([
  "transition",
  "transition-property",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-composition",
]);

// `repeat:` copy cap — a typo'd count must not OOM. Above this is a diagnostic.
const REPEAT_CAP = 10000;

// A lone/un-repeated node is sibling 1-of-its-actual-count; the real index/count
// are filled in by buildSiblings before buildNode runs.
const ROOT_SIBLING: SiblingContext = { index: 1, count: 1 };

const isPolystar = (sd: ShapeData): sd is PolystarData =>
  sd.type === "star" || sd.type === "polygon";

// Set one corner (0=tl,1=tr,2=br,3=bl) of a rect's per-corner radii, seeding the
// tuple from the current uniform rx so an unset corner keeps the uniform radius.
function setCornerRadius(node: SceneNode, index: number, value: number): void {
  if (node.shapeData.type !== "rect") return;
  const rect = node.shapeData as RectData;
  const seed = rect.rx || 0;
  const c: [number, number, number, number] = rect.cornerRadii
    ? [...rect.cornerRadii]
    : [seed, seed, seed, seed];
  c[index] = value;
  rect.cornerRadii = c;
}

// CSS gradient functions accepted as a fill/stroke paint (+ their repeating
// tiled variants). conic and every repeating-* form route through parseGradient.
const GRADIENT_FN = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

// Properties whose static `:root` var() references are folded to their literal
// at build time (path/geometry dedup from the Lottie converter, hoisted custom
// props). These carry structured, build-resolved data (a command list, a motion
// path, a clip) — not a live value — so a static var here becomes a constant,
// not a binding. Every OTHER property keeps its var() intact so it forms a
// per-frame binding and stays host-overridable (setVariable re-resolves it).
const STRUCTURAL_FOLD_PROPERTIES = new Set([
  "d",
  "offset-path",
  "clip-path",
  "mask",
]);

// String/keyword-valued properties a reactive var() may drive at runtime. These
// have no registry handler (not animatable) and aren't color paint, so the
// binding path re-applies their resolved value through the declaration switch
// each frame. Discrete by nature (no interpolation). Numeric/color/transform
// properties are handled by their own binding branches and stay out of this set.
const STRING_BINDABLE_PROPERTIES = new Set([
  "content",
  "font-family",
  "font-weight",
  "text-anchor",
  "text-align",
  "fill-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "paint-order",
  "visibility",
  "mix-blend-mode",
]);

// CSS mix-blend-mode keywords (every one maps to all three backends).
const BLEND_MODES = new Set<string>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

// One warning per animation whose object-valued keyframes (gradients/paths)
// can't interpolate — interpolation will step to the departing value instead.
const warnedAnimations = new Set<string>();
function warnIncompatibleObjectKeyframes(
  name: string,
  frames: KeyframeData[],
): void {
  const sorted = [...frames].sort((a, b) => a.offset - b.offset);
  for (const prop of ["fill", "stroke", "d", "clip-path"] as const) {
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].properties[prop];
      const b = sorted[i + 1].properties[prop];
      if (a === undefined || b === undefined) continue;
      let ok: boolean;
      if (prop === "d" || prop === "clip-path") {
        // d/clip-path array values are always PathCommand[] (never FilterOp[]).
        ok =
          Array.isArray(a) &&
          Array.isArray(b) &&
          pathsCompatible(a as PathCommand[], b as PathCommand[]);
      } else if (!isGradientData(a) && !isGradientData(b)) {
        ok = true; // plain color-to-color fill/stroke: interpolates fine
      } else {
        ok =
          isGradientData(a) && isGradientData(b) && gradientsCompatible(a, b);
      }
      if (!ok && !warnedAnimations.has(name)) {
        warnedAnimations.add(name);
        console.warn(
          `@keyframes ${name}: incompatible ${prop} keyframes; animation will step (hold) instead of interpolating.`,
        );
      }
    }
  }
}

/**
 * Build scene graph from AST
 */
type TransformKey =
  | "translateX"
  | "translateY"
  | "rotate"
  | "scaleX"
  | "scaleY"
  | "skewX"
  | "skewY";

/**
 * Walk a transform value (a single function or a list of them) and report each
 * resolved channel to `set`. Single source for the translate/rotate/scale
 * function-name mapping — used for base transforms, state styles, and keyframes.
 */
// `resolve` maps each operand to a number; defaults to the static build-time
// reader. The per-frame binding path (loop.applyBindings) passes a var()/input()-
// resolving reader so a `transform: translate(var(--x), …)` follows its inputs.
export function extractTransform(
  value: Value,
  set: (key: TransformKey, val: number) => void,
  resolve: (v: Value) => number = getNumericValue,
): void {
  const single = (name: string, args: Value[]) => {
    switch (name) {
      case "translate":
        set("translateX", resolve(args[0]));
        set("translateY", args.length > 1 ? resolve(args[1]) : 0);
        break;
      case "translateX":
        set("translateX", resolve(args[0]));
        break;
      case "translateY":
        set("translateY", resolve(args[0]));
        break;
      case "rotate":
        set("rotate", resolve(args[0]));
        break;
      case "scale": {
        const sx = resolve(args[0]);
        set("scaleX", sx);
        set("scaleY", args.length > 1 ? resolve(args[1]) : sx);
        break;
      }
      case "scaleX":
        set("scaleX", resolve(args[0]));
        break;
      case "scaleY":
        set("scaleY", resolve(args[0]));
        break;
      case "skew":
        set("skewX", resolve(args[0]));
        set("skewY", args.length > 1 ? resolve(args[1]) : 0);
        break;
      case "skewX":
        set("skewX", resolve(args[0]));
        break;
      case "skewY":
        set("skewY", resolve(args[0]));
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
 * NOTE: these write the SAME channels as the `transform:` shorthand (single
 * source of transform math, invariant #1) rather than modeling CSS's separate
 * translate/rotate/scale/transform layering. So mixing them with `transform:` on
 * one node is last-declaration-wins per channel, not additive layering.
 */
export function extractIndividualTransform(
  property: string,
  value: Value,
  set: (key: TransformKey, val: number) => void,
  resolve: (v: Value) => number = getNumericValue,
): boolean {
  const parts = isListValue(value) ? value.values : [value];
  switch (property) {
    case "translate":
      set("translateX", resolve(parts[0]));
      set("translateY", parts.length > 1 ? resolve(parts[1]) : 0);
      return true;
    case "rotate":
      set("rotate", resolve(parts[0]));
      return true;
    case "scale": {
      const sx = resolve(parts[0]);
      set("scaleX", sx);
      set("scaleY", parts.length > 1 ? resolve(parts[1]) : sx);
      return true;
    }
  }
  return false;
}

// Parse an `object-view-box` value into an image source-crop rect (in image
// pixels), or null for `none` / anything unrecognized (draw the whole bitmap).
// Only the `xywh(x y w h)` basic-shape form is supported — its four components
// map straight onto sprite-frame offsets, and stay concrete numbers so they
// animate/bind component-wise (unlike `inset()`, whose right/bottom edges depend
// on the runtime intrinsic size). `resolve` maps each operand to a number;
// defaults to the static build-time reader, the per-frame binding path passes a
// var()/input()-resolving one (mirrors extractTransform).
// NOTE: `inset()` cropping is the ceiling here — supporting it means resolving
// its edge insets against the decoded intrinsic size in the shared walk.
export function extractImageViewBox(
  value: Value,
  resolve: (v: Value) => number = getNumericValue,
): ImageViewBox | null {
  if (isKeywordValue(value) && value.value === "none") return null;
  if (
    isFunctionValue(value) &&
    value.name === "xywh" &&
    value.args.length >= 4
  ) {
    return {
      x: resolve(value.args[0]),
      y: resolve(value.args[1]),
      width: resolve(value.args[2]),
      height: resolve(value.args[3]),
    };
  }
  return null;
}

// True when an object-view-box value has a reactive var()/input()/calc() operand
// (so the whole value registers as a per-frame binding rather than baking).
function objectViewBoxHasVariable(value: Value): boolean {
  const argHasVar = (v: Value): boolean =>
    isVariableRefValue(v) ||
    (isFunctionValue(v) && v.name === "input") ||
    (isCalcValue(v) && calcOperands(v.expr).some(argHasVar));
  return isFunctionValue(value) && value.args.some(argHasVar);
}

// True when a transform value (`transform:` shorthand or a `translate`/`rotate`/
// `scale` individual prop) has any var()/input()/reactive-calc() operand. Those
// channels can't ride the scalar-binding path (transform is a compound function
// value), so the whole value is registered as a per-frame binding the loop
// re-extracts each frame — mirroring how `cx: var(--x)` works for scalars.
export function transformHasVariable(value: Value): boolean {
  const argHasVar = (v: Value): boolean =>
    isVariableRefValue(v) ||
    (isFunctionValue(v) && v.name === "input") ||
    (isCalcValue(v) && calcOperands(v.expr).some(argHasVar));
  const items = isListValue(value) ? value.values : [value];
  for (const item of items) {
    if (isFunctionValue(item) && item.args.some(argHasVar)) return true;
    // Individual transform props carry bare operands (e.g. `translate: var(--x)`).
    if (argHasVar(item)) return true;
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
  private pendingMasks: {
    node: SceneNode;
    sourceId: string;
    mode: MaskMode;
  }[] = [];
  // The sheet being built + a memoized document seed for random(). The seed is a
  // hash of the canonical serialization, so identical source rolls identically;
  // computed lazily on the first random() so random-free scenes pay nothing.
  private sheet: StyleSheet | null = null;
  private docSeed: number | null = null;
  // Set once any `repeat:` stamps >1 copy, so the post-build id-uniqueness check
  // (derived-id collisions) runs only for scenes that actually instanced.
  private usedRepeat = false;

  build(stylesheet: StyleSheet): SceneNode {
    this.sheet = stylesheet;
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
    // `repeat:` is instance context, not template — a @define body may never
    // carry it (its count would be ambiguous at every use site).
    for (const def of stylesheet.definitions) {
      assertNoRepeatInDefinition(def);
    }

    // Create root node
    const root = createSceneNode("root", "group");

    // Process rules (expanding `repeat:` into consecutive real sibling nodes).
    this.buildSiblings(stylesheet.rules, root);

    // Derived-id collisions (a copy's id equal to an explicitly-declared node's,
    // or to another copy's) surface as duplicate scene ids; only worth walking
    // when the scene actually instanced.
    if (this.usedRepeat) assertUniqueIds(root);

    this.resolveMasks(root);
    this.unTrapMaskedContent(root);

    // Attach state machines to the root and flag their pointer-trigger targets
    // as interactive so the shared hit-tester credits them (see loop pointer
    // detection). Done after the whole tree exists, like mask resolution.
    root.machines = stylesheet.machines;
    this.markPointerTargets(root, stylesheet.machines);

    return root;
  }

  /**
   * Flag every node named by a `on <pointer>(#id)` machine trigger as
   * `interactive`, so the existing hit-tester (which only credits interactive
   * nodes) returns it. Ids namespaced under a @define instance (`inst.child`)
   * are matched by their trailing segment too, mirroring findDirectChild.
   */
  private markPointerTargets(root: SceneNode, machines: MachineRule[]): void {
    const ids = new Set<string>();
    for (const m of machines) {
      for (const s of m.states) {
        for (const tr of s.transitions) {
          if (
            tr.trigger &&
            tr.trigger.kind === "pointer" &&
            tr.trigger.target.type === "id"
          ) {
            ids.add(tr.trigger.target.name);
          }
        }
      }
    }
    if (ids.size === 0) return;
    const visit = (n: SceneNode): void => {
      if (ids.has(n.id) || [...ids].some((id) => n.id.endsWith("." + id)))
        n.interactive = true;
      n.children.forEach(visit);
    };
    visit(root);
  }

  /**
   * Wire up authored `mask:` references now that every node exists. The mask
   * source is looked up by id anywhere in the scene; the referenced node is
   * flagged so the renderer paints it only as a mask, never on its own.
   */
  private resolveMasks(root: SceneNode): void {
    if (this.pendingMasks.length === 0) return;
    const byId = new Map<string, SceneNode>();
    const index = (n: SceneNode) => {
      byId.set(n.id, n);
      n.children.forEach(index);
    };
    index(root);

    for (const { node, sourceId, mode } of this.pendingMasks) {
      const source = byId.get(sourceId);
      if (!source) {
        throw new Error(
          `mask on '${node.id}' references unknown node '#${sourceId}'`,
        );
      }
      node.mask = { source, mode };
      source.isMaskSource = true;
    }
    this.pendingMasks = [];
  }

  /**
   * Un-trap matte content that is transform-parented to its own matte source.
   *
   * Lottie parenting is transform-only, but a track-matte content layer is often
   * ALSO parented to its matte source (the fish's Tail/Fins: `parent === tp`), so
   * the converter nests the content *inside* the source. That collides with the
   * matte semantics: the source is `isMaskSource`, and the render walk skips a
   * mask source's whole subtree — so the nested content never paints, and were it
   * reached it would pollute the source's own matte.
   *
   * Fix: for each source `S` that directly parents content masking it, split `S`
   * into a plain transform group (keeping `S`'s transform) holding a fresh
   * `#S-matte` sub-group (the real mask source, holding `S`'s own shapes) as a
   * SIBLING of the content. The content keeps `S` as its transform parent (so its
   * world transform is unchanged) but is no longer inside the mask source, so it
   * paints normally and the matte samples only `S`'s own shapes.
   */
  private unTrapMaskedContent(root: SceneNode): void {
    const sources: SceneNode[] = [];
    const collect = (n: SceneNode) => {
      // A source S traps content when a direct child of S is masked by S.
      if (n.isMaskSource && n.children.some((c) => c.mask?.source === n))
        sources.push(n);
      n.children.forEach(collect);
    };
    collect(root);

    for (const s of sources) {
      const content = s.children.filter((c) => c.mask?.source === s);
      const own = s.children.filter((c) => c.mask?.source !== s); // S's own matte shapes

      const matte = createSceneNode(`${s.id}-matte`, "group");
      matte.parent = s;
      matte.base = snapshotNode(matte);
      for (const c of own) c.parent = matte;
      matte.children = own;
      matte.isMaskSource = true;

      // S becomes a plain transform group; its matte now lives in `matte`.
      s.isMaskSource = false;
      s.children = [matte, ...content];
      // Repoint every node masked by S (trapped or not) at the matte holder.
      this.repointMaskSource(root, s, matte);
    }
  }

  private repointMaskSource(
    node: SceneNode,
    from: SceneNode,
    to: SceneNode,
  ): void {
    if (node.mask?.source === from) node.mask.source = to;
    node.children.forEach((c) => {
      this.repointMaskSource(c, from, to);
    });
  }

  private buildNode(rule: Rule, sib: SiblingContext = ROOT_SIBLING): SceneNode {
    // Expand a `use: <symbol>` reference into a merged rule before building.
    rule = this.expandUse(rule);

    const id = rule.selector.name;
    // Freeze any random() in this node's declarations to fixed literals now, so
    // everything downstream (structural fold, calc, state blocks) sees a
    // constant. Keyframe random() is frozen per-node in buildKeyframes instead.
    rule = this.freezeRandomInRule(rule, id);
    // Substitute sibling-index()/sibling-count() in this node's own declarations
    // with its position among siblings — structural, so it folds to a constant
    // the same way. Keyframe sibling fns are folded per-node in buildKeyframes.
    rule = this.foldSiblingInRule(rule, sib);
    let shapeType: ShapeType = "group";

    // First pass: find shape type
    for (const decl of rule.declarations) {
      if (decl.property === "type") {
        shapeType = getStringValue(decl.value) as ShapeType;
        break;
      }
    }

    const node = createSceneNode(id, shapeType);
    // Materialize the typed shapeData up front so declarations are applied in a
    // CSS-order-independent way: shape props (font-size, content, width, …) guard
    // on shapeData.type, so a declaration preceding this would otherwise be
    // dropped against the default group shapeData (fill/opacity are node-level and
    // stayed unaffected — the tell-tale asymmetry).
    this.ensureShapeData(node);

    if (rule.selector.type === "class") {
      node.className = id;
    }

    // Apply declarations
    this.applyDeclarations(node, rule.declarations);

    // Resolve `x`/`y` bounding-box sugar on circle/ellipse (left/top aliases
    // land here too) into cx/cy, now that r/rx/ry and any explicit cx/cy are
    // final — order-independent by construction.
    this.resolveCircleEllipseBoxPosition(node);

    // Resolve the `animation` shorthand together with the `animation-*`
    // longhands (CSS composition: later declarations win per sub-property).
    this.resolveAnimations(node, rule.declarations, sib);

    // Node-level transitions (apply to interaction state changes).
    node.transitions = this.resolveTransitions(rule.declarations);

    // Extract state-specific styles from pseudo rules. Child rules nested inside
    // a state block (`&:hover > #c {…}` or `&:state(s) > #c {…}`) are deferred
    // until this node's own children exist, then resolved against them below.
    const stateChildRules: { rule: Rule; state: "hover" | "active" }[] = [];
    const machineChildRules: {
      rule: Rule;
      machineState: { machine: string | null; name: string };
    }[] = [];
    if (rule.states && rule.states.length > 0) {
      for (const stateRule of rule.states) {
        if (stateRule.state === "state") {
          // Machine `:state(name)` / `:state(machine.name)` block. Unlike
          // hover/active it may carry `animation:`, resolved (per node) through
          // the same path as node-level animations.
          const ms = stateRule.machineState!;
          node.stateStyles.push({
            machine: ms.machine,
            name: ms.name,
            styles: this.buildStateStyles(stateRule.declarations),
            animations: this.buildAnimations(
              stateRule.declarations,
              true,
              node.id,
              sib,
            ),
          });
          for (const childRule of stateRule.children) {
            machineChildRules.push({ rule: childRule, machineState: ms });
          }
          continue;
        }
        const stateStyles = this.buildStateStyles(stateRule.declarations);
        if (stateRule.state === "hover") {
          node.hoverStyles = stateStyles;
        } else if (stateRule.state === "active") {
          node.activeStyles = stateStyles;
        }
        for (const childRule of stateRule.children) {
          stateChildRules.push({ rule: childRule, state: stateRule.state });
        }
        // A hover/active block makes the node hit-testable. `:state()` alone
        // does not (machine state is global, not pointer-driven).
        node.interactive = true;
      }
    }

    // Process children (`repeat:` expands here too, so nesting multiplies).
    this.buildSiblings(rule.children, node);

    // Resolve deferred state-child rules: attach each state block's overrides to
    // the targeted direct child, and record the child so this node's state flip
    // drives it (see interaction.ts). The child stays non-interactive.
    for (const { rule: childRule, state } of stateChildRules) {
      const target = findDirectChild(node, childRule.selector);
      if (!target) {
        console.warn(
          `&:${state} > ${childRule.selector.type === "class" ? "." : "#"}${childRule.selector.name} in '${node.id}' targets no direct child; ignored.`,
        );
        continue;
      }
      const styles = this.buildStateStyles(childRule.declarations);
      if (state === "hover") target.hoverStyles = styles;
      else target.activeStyles = styles;
      if (!node.stateChildren.includes(target)) node.stateChildren.push(target);
    }

    // Resolve deferred machine-state child rules (`&:state(s) > #c {…}`). Unlike
    // hover children these don't ride a parent flip — machine state is global —
    // so the set is attached straight to the child's own stateStyles and merged
    // in the walk exactly like the child's own `&:state` blocks.
    for (const { rule: childRule, machineState } of machineChildRules) {
      const target = findDirectChild(node, childRule.selector);
      if (!target) {
        console.warn(
          `&:state(${machineState.name}) > ${childRule.selector.type === "class" ? "." : "#"}${childRule.selector.name} in '${node.id}' targets no direct child; ignored.`,
        );
        continue;
      }
      target.stateStyles.push({
        machine: machineState.machine,
        name: machineState.name,
        styles: this.buildStateStyles(childRule.declarations),
        animations: this.buildAnimations(
          childRule.declarations,
          true,
          node.id,
          sib,
        ),
      });
    }

    // Capture the authored render state as the immutable base for the
    // per-frame value-resolution pipeline.
    node.base = snapshotNode(node);

    return node;
  }

  /** The document seed for random(): hash of the sheet's canonical serialization. */
  private documentSeed(): number {
    this.docSeed ??= hashString(serialize(this.sheet as StyleSheet));
    return this.docSeed;
  }

  /**
   * Freeze every random() in a rule's OWN declarations (and its state blocks) to
   * fixed literals keyed by this node's id — the sharing rules: default calls
   * share a roll across all instances of a declaration, `per-element` rolls per
   * node id, a `<dashed-ident>` correlates by ident. Returns the rule unchanged
   * (no allocation) when it has no random(). Child rules are NOT descended here —
   * each is frozen by its own buildNode against its own id.
   * NOTE: a state-child block (`&:hover > #c`) is frozen against the PARENT id,
   * not #c's — those overrides never pass through #c's buildNode. Rare enough to
   * accept; the per-element knob still works on a node's own declarations.
   */
  private freezeRandomInRule(rule: Rule, nodeId: string): Rule {
    const seed = this.documentSeed.bind(this);
    let sawRandom = false;
    const mapDecls = (decls: Declaration[]): Declaration[] =>
      decls.map((d) => {
        if (!valueHasRandom(d.value)) return d;
        sawRandom = true;
        return {
          ...d,
          value: freezeRandom(d.value, {
            documentSeed: seed(),
            nodeId,
            property: d.property,
          }),
        };
      });

    const declarations = mapDecls(rule.declarations);
    const states = rule.states.map((s) => ({
      ...s,
      declarations: mapDecls(s.declarations),
      children: s.children.map((c) => ({
        ...c,
        declarations: mapDecls(c.declarations),
      })),
    }));
    return sawRandom ? { ...rule, declarations, states } : rule;
  }

  /**
   * Substitute sibling-index()/sibling-count() in a rule's OWN declarations (and
   * its state blocks) with this node's structural position, mirroring
   * freezeRandomInRule. Child rules are NOT descended — each resolves against its
   * own sibling position in its own buildNode. Returns the rule unchanged (no
   * allocation) when it uses neither function.
   * NOTE: a state-child block (`&:hover > #c`) folds against the PARENT's
   * position, not #c's — same accepted edge as freezeRandomInRule.
   */
  private foldSiblingInRule(rule: Rule, sib: SiblingContext): Rule {
    let sawFn = false;
    const mapDecls = (decls: Declaration[]): Declaration[] =>
      decls.map((d) => {
        if (!valueHasSiblingFn(d.value)) return d;
        sawFn = true;
        return { ...d, value: foldSiblingFns(d.value, sib) };
      });

    const declarations = mapDecls(rule.declarations);
    const states = rule.states.map((s) => ({
      ...s,
      declarations: mapDecls(s.declarations),
      children: s.children.map((c) => ({
        ...c,
        declarations: mapDecls(c.declarations),
      })),
    }));
    return sawFn ? { ...rule, declarations, states } : rule;
  }

  /**
   * Build a list of sibling rules into `parent`, expanding any `repeat:` into
   * consecutive real nodes first, then resolving sibling-index()/-count() against
   * the fully-expanded list (spec: both count ALL siblings, in document order).
   */
  private buildSiblings(rules: Rule[], parent: SceneNode): void {
    const expanded: Rule[] = [];
    const derived = new Set<string>();
    for (const rule of rules) this.expandRepeat(rule, expanded, derived);

    // Per-copy override: a later pure-property rule (`#field-3 { fill: red }` —
    // no type/use/children of its own) whose id names an already-emitted repeat
    // copy folds its declarations onto that copy (last wins), rather than adding
    // a fourth node. A rule that re-establishes the node (type/use/children) is
    // NOT an override — it stays a separate node and trips the id-collision
    // check. Reuses mergeStates + the normal buildNode declaration pass.
    const slot = new Map<string, Rule>();
    const finalRules: Rule[] = [];
    for (const rule of expanded) {
      const id = rule.selector.type === "id" ? rule.selector.name : "";
      const base = id ? slot.get(id) : undefined;
      if (base && derived.has(id) && isPureOverride(rule)) {
        const merged: Rule = {
          ...base,
          declarations: [...base.declarations, ...rule.declarations],
          states: mergeStates(base.states, rule.states),
        };
        finalRules[finalRules.indexOf(base)] = merged;
        slot.set(id, merged);
        continue;
      }
      finalRules.push(rule);
      if (id) slot.set(id, rule);
    }

    const count = finalRules.length;
    finalRules.forEach((rule, i) => {
      const node = this.buildNode(rule, { index: i + 1, count });
      node.parent = parent;
      parent.children.push(node);
    });
  }

  /**
   * Expand one authored rule into 1..N real sibling rules, appending them to
   * `out`. `repeat: <n>` stamps N copies whose ids derive `#field` -> `field-1`
   * … `field-N` (descendant ids re-suffixed too, keeping the subtree unique and
   * per-copy targetable); `repeat: 1` and no `repeat:` pass through untouched.
   * The count is structural — folded now, like `use:` — so nested repeats
   * multiply naturally when each copy's children are expanded in turn.
   */
  private expandRepeat(rule: Rule, out: Rule[], derived: Set<string>): void {
    const n = this.repeatCount(rule);
    if (n === null) {
      out.push(rule);
      return;
    }
    const base = stripRepeatDecl(rule);
    if (n === 1) {
      out.push(base); // `repeat: 1` ≡ absent
      return;
    }
    this.usedRepeat = true;
    for (let i = 1; i <= n; i++) {
      const copy = suffixRuleIds(base, `-${i}`);
      if (copy.selector.type === "id") derived.add(copy.selector.name);
      out.push(copy);
    }
  }

  /**
   * The `repeat:` count for a rule, or null when it has none. The count is
   * structural: static `var()`/`calc()` fold to a literal, but a reactive
   * `input()`/`var()` is rejected — node count can't vary per frame (the render
   * walk is a pure function of time over a fixed tree). 0/negative/non-integer
   * and over-cap counts are diagnostics.
   */
  private repeatCount(rule: Rule): number | null {
    const decl = rule.declarations.find((d) => d.property === "repeat");
    if (!decl) return null;
    const id = rule.selector.name;
    const resolved = this.resolveStaticVars(decl.value);
    if (this.hasVariableReference(resolved)) {
      throw new Error(
        `repeat on '#${id}' must be a static count, not a reactive input()/var() (node count is fixed over the timeline)`,
      );
    }
    if (!isNumberValue(resolved) || !Number.isInteger(resolved.value)) {
      throw new Error(
        `repeat on '#${id}' must be a positive integer (use display:none to hide a node)`,
      );
    }
    const value = resolved.value;
    if (value < 1) {
      throw new Error(
        `repeat on '#${id}' must be >= 1 (use display:none to hide a node), got ${value}`,
      );
    }
    if (value > REPEAT_CAP) {
      throw new Error(
        `repeat on '#${id}' is ${value}, over the cap of ${REPEAT_CAP}`,
      );
    }
    return value;
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
    const useDecl = rule.declarations.find((d) => d.property === "use");
    if (!useDecl) return rule;

    const name = getStringValue(useDecl.value);
    const def = this.definitionsMap.get(name);
    if (!def) {
      throw new Error(
        `unknown symbol '${name}' referenced by use: in rule '${rule.selector.name}'`,
      );
    }
    if (inProgress.has(name)) {
      throw new Error(
        `cyclic symbol definition: ${[...inProgress, name].join(" -> ")}`,
      );
    }
    inProgress.add(name);

    // Resolve the definition's own body first (it may `use:` another symbol).
    const resolvedDef = this.expandUse(
      {
        type: "rule",
        selector: { type: "id", name },
        declarations: def.declarations,
        children: def.children,
        states: def.states,
        // Synthetic wrapper around a @define body — no source span of its own.
        span: { start: 0, end: 0 },
        preludeSpan: { start: 0, end: 0 },
      },
      inProgress,
    );
    inProgress.delete(name);

    const instanceId = rule.selector.name;
    return {
      type: "rule",
      selector: rule.selector,
      // Def declarations first, use-site second so use-site overrides win; the
      // `use` decl itself is dropped from both.
      declarations: [
        ...resolvedDef.declarations.filter((d) => d.property !== "use"),
        ...rule.declarations.filter((d) => d.property !== "use"),
      ],
      // Cloned+namespaced def children, then the use-site's own children.
      children: [
        ...resolvedDef.children.map((c) => namespaceChild(c, instanceId)),
        ...rule.children,
      ],
      states: mergeStates(resolvedDef.states, rule.states),
      span: rule.span,
      preludeSpan: rule.preludeSpan,
    };
  }

  /**
   * Build state-specific styles from a state block's declarations. Shared by a
   * node's own &:hover/&:active block and by a state-child rule (`&:hover > #c`),
   * both of which consume the same property subset.
   */
  private buildStateStyles(declarations: Declaration[]): StateStyles {
    const styles: StateStyles = {};

    for (const decl of declarations) {
      const { property, value } = decl;

      switch (property) {
        case "fill": {
          // Same paint resolution as a plain declaration: a gradient function
          // becomes structured GradientData (invalid => null => no fill), any
          // color/keyword/rgb() becomes a solid string. The two channels are
          // mutually exclusive; applyStateStyles clears the other on apply.
          const paint = this.parsePaint(value);
          if (paint?.type === "gradient") {
            styles.fillGradient = paint.gradient;
          } else if (paint) {
            styles.fill = paint.color;
          }
          break;
        }

        case "stroke": {
          const paint = this.parsePaint(value);
          if (paint?.type === "gradient") {
            styles.strokeGradient = paint.gradient;
          } else if (paint) {
            styles.stroke = paint.color;
          }
          break;
        }

        case "stroke-width":
          styles.strokeWidth = getNumericValue(value);
          break;

        case "opacity":
          styles.opacity = getNumericValue(value);
          break;

        case "transform":
          styles.transform = {
            ...styles.transform,
            ...this.extractStateTransform(value),
          };
          break;

        case "translate":
        case "rotate":
        case "scale": {
          // CSS individual transform properties in a state block: merge into the
          // same channel deltas (last-declaration-wins per channel).
          styles.transform ??= {};
          const t = styles.transform;
          extractIndividualTransform(property, value, (key, val) => {
            t[key] = val;
          });
          break;
        }

        default: {
          // Every property the registry can animate is overridable in a state
          // block as an instant snap: parse its endpoint the same way keyframes
          // do and stash it in `overrides`, keyed by property name. applyState-
          // Styles feeds each entry to the property's registry handler (which
          // sets any dirty flags for free — invariant #3). A handler that no-ops
          // on this node's shape is silently inert, same as a keyframe would be.
          // transition* is consumed by resolveTransitions below, so it's ignored
          // here; anything else with no registry entry is a genuine unknown.
          const value = this.resolveStaticVars(decl.value);
          if (getPropHandler(property)) {
            const parsed = this.parseAnimatableValue(property, value);
            if (parsed !== undefined) {
              styles.overrides ??= {};
              styles.overrides[property] = parsed;
            }
          } else if (!STATE_BLOCK_IGNORED.has(property)) {
            console.warn(
              `Unknown property '${property}' in a :hover/:active/:state() block; ignored.`,
            );
          }
        }
      }
    }

    // Transitions declared inside the state block govern entering that state.
    const transitions = this.resolveTransitions(declarations);
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

  /**
   * `x`/`y` (and thus the `left`/`top` parser aliases) on circle/ellipse are
   * input sugar for the bounding-box top-left, converted to the canonical
   * `cx`/`cy` center form: `cx = x + r` (ellipse: `+ rx`), `cy = y + r`
   * (`+ ry`). Explicit `cx`/`cy` wins if both are given. Static placement
   * only — not wired into the animation registry.
   */
  private resolveCircleEllipseBoxPosition(node: SceneNode): void {
    if (node.shapeData.type === "circle") {
      const d = node.shapeData as CircleData;
      if (d.__boxX !== undefined && !d.__cxSet) d.cx = d.__boxX + d.r;
      if (d.__boxY !== undefined && !d.__cySet) d.cy = d.__boxY + d.r;
      delete d.__boxX;
      delete d.__boxY;
      delete d.__cxSet;
      delete d.__cySet;
    } else if (node.shapeData.type === "ellipse") {
      const d = node.shapeData as EllipseData;
      if (d.__boxX !== undefined && !d.__cxSet) d.cx = d.__boxX + d.rx;
      if (d.__boxY !== undefined && !d.__cySet) d.cy = d.__boxY + d.ry;
      delete d.__boxX;
      delete d.__boxY;
      delete d.__cxSet;
      delete d.__cySet;
    }
  }

  private applyDeclarations(
    node: SceneNode,
    declarations: Declaration[],
  ): void {
    for (const decl of declarations) {
      this.applyDeclaration(node, decl);
    }
  }

  /** Image source from a `url('…')` function value, or a bare string. */
  private imageSrc(value: Value): string {
    if (isFunctionValue(value) && value.name === "url") {
      return value.args.length > 0 ? getStringValue(value.args[0]) : "";
    }
    return getStringValue(value);
  }

  private applyDeclaration(node: SceneNode, decl: Declaration): void {
    const { property } = decl;
    // Fold static `:root` var() references to their definitions at build time
    // ONLY for structural properties (path/clip/mask dedup, e.g. the hoisted
    // `d:`/`offset-path:`/`clip-path:` the Lottie converter emits), so their
    // build-resolved geometry flows through normal parsing below. Every other
    // property keeps its var() intact so it forms a per-frame binding and stays
    // host-overridable — setVariable re-resolves the color/string/number live.
    const value = STRUCTURAL_FOLD_PROPERTIES.has(property)
      ? this.resolveStaticVars(decl.value)
      : decl.value;

    // animation-timeline holds a live 0..1 value SOURCE (var()/input()), not a
    // property binding — it scrubs the node's animations rather than writing a
    // field. Store the UNRESOLVED value (decl.value, not `value`) so a var()
    // pointing at a static :root default stays host-overridable; resolved fresh
    // each frame by the loop.
    if (property === "animation-timeline") {
      node.animationTimeline = decl.value;
      return;
    }

    // Check if this value contains a variable reference
    if (this.hasVariableReference(value)) {
      // Store as a dynamic binding to be resolved at render time.
      const binding: PropertyBinding = { property, value };
      // String/keyword properties can't ride the numeric/color binding paths;
      // capture a closure that re-applies the resolved (var-free) value through
      // this same switch each frame, reusing the build-time field logic.
      if (STRING_BINDABLE_PROPERTIES.has(property)) {
        binding.applyString = (n, resolved) =>
          this.applyDeclaration(n, { ...decl, value: resolved });
      }
      node.bindings.push(binding);
      return;
    }

    switch (property) {
      case "type":
        // Already handled
        break;

      // Transform properties. A reactive var()/input() operand (e.g.
      // `translate(var(--x), …)`) is registered as a per-frame binding rather
      // than baked here — the loop re-extracts it each frame (applyBindings).
      case "transform":
        if (transformHasVariable(value)) {
          node.bindings.push({ property, value });
        } else {
          this.applyTransform(node, value);
        }
        break;

      // CSS individual transform properties -> the same channels as transform:.
      case "translate":
      case "rotate":
      case "scale":
        if (transformHasVariable(value)) {
          node.bindings.push({ property, value });
        } else {
          extractIndividualTransform(property, value, (key, val) => {
            node.transform[key] = val;
          });
        }
        break;

      case "transform-origin":
        this.applyTransformOrigin(node, value);
        break;

      // Position/size for rect (x/y are also the text anchor point)
      case "x":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).x = getNumericValue(value);
        } else if (node.shapeData.type === "text") {
          (node.shapeData as TextData).x = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          (node.shapeData as ImageData).x = getNumericValue(value);
        } else if (
          node.shapeData.type === "circle" ||
          node.shapeData.type === "ellipse"
        ) {
          // NOTE: input sugar only (bounding-box top-left → center), resolved
          // once all of the node's declarations are known — see
          // resolveCircleEllipseBoxPosition. cx/cy stay the canonical,
          // serialized form; x/y here are not animatable.
          (node.shapeData as CircleData | EllipseData).__boxX =
            getNumericValue(value);
        }
        break;
      case "y":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).y = getNumericValue(value);
        } else if (node.shapeData.type === "text") {
          (node.shapeData as TextData).y = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          (node.shapeData as ImageData).y = getNumericValue(value);
        } else if (
          node.shapeData.type === "circle" ||
          node.shapeData.type === "ellipse"
        ) {
          (node.shapeData as CircleData | EllipseData).__boxY =
            getNumericValue(value);
        }
        break;

      // Text content, or image source (`content: url('…')`).
      case "content":
        if (node.shapeData.type === "text") {
          (node.shapeData as TextData).content = getStringValue(value);
        } else if (node.shapeData.type === "image") {
          (node.shapeData as ImageData).src = this.imageSrc(value);
        }
        break;

      // Image source-crop (sprite-sheet frame). A reactive var()/input()/calc()
      // operand registers a per-frame binding (loop re-extracts it, like a
      // reactive transform); otherwise bake the static crop. Not caught by the
      // early hasVariableReference branch — a bare `xywh(...)` function isn't
      // recursed into there (same as `transform:`), so it always reaches here.
      case "object-view-box":
        if (node.shapeData.type === "image") {
          if (objectViewBoxHasVariable(value)) {
            node.bindings.push({ property, value });
          } else {
            (node.shapeData as ImageData).viewBox = extractImageViewBox(value);
          }
        }
        break;
      case "font-size":
        if (node.shapeData.type === "text") {
          (node.shapeData as TextData).fontSize = getNumericValue(value);
        }
        break;
      case "font-family":
        if (node.shapeData.type === "text") {
          // A comma fallback stack (`system-ui, sans-serif`) parses to a list;
          // join it back so ctx.font gets a real family. An empty family makes
          // the whole `${weight} ${size}px ${family}` string invalid, so the
          // browser rejects it and text silently pins to the canvas default.
          (node.shapeData as TextData).fontFamily = isListValue(value)
            ? value.values.map(getStringValue).join(", ")
            : getStringValue(value);
        }
        break;
      case "font-weight":
        if (node.shapeData.type === "text") {
          // Keyword ('bold') or numeric weight (700) — store as a string for ctx.font.
          (node.shapeData as TextData).fontWeight = isNumberValue(value)
            ? String(value.value)
            : getStringValue(value) || "normal";
        }
        break;
      case "text-anchor":
        if (
          node.shapeData.type === "text" &&
          isKeywordValue(value) &&
          (value.value === "start" ||
            value.value === "middle" ||
            value.value === "end")
        ) {
          (node.shapeData as TextData).anchor = value.value as TextAnchor;
        }
        break;
      // CSS text-align mapped onto the text-anchor semantics: left/start ->
      // start, center -> middle, right/end -> end.
      case "text-align":
        if (node.shapeData.type === "text" && isKeywordValue(value)) {
          const a =
            value.value === "center"
              ? "middle"
              : value.value === "right" || value.value === "end"
                ? "end"
                : "start";
          (node.shapeData as TextData).anchor = a;
        }
        break;
      case "letter-spacing":
        if (node.shapeData.type === "text") {
          (node.shapeData as TextData).letterSpacing = getNumericValue(value);
          node.textBoundsDirty = true;
        }
        break;
      // line-height: px/% resolve against the font-size, a unitless number is a
      // multiplier. NOTE: resolved once here against the font-size known at this
      // point (author font-size before line-height); it doesn't re-resolve if
      // font-size later animates.
      case "line-height":
        if (node.shapeData.type === "text") {
          const t = node.shapeData as TextData;
          t.lineHeight =
            isLengthValue(value) && value.unit === "%"
              ? (getNumericValue(value) / 100) * t.fontSize
              : isNumberValue(value)
                ? getNumericValue(value) * t.fontSize
                : getNumericValue(value);
          node.textBoundsDirty = true;
        }
        break;
      case "width":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).width = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          (node.shapeData as ImageData).width = getNumericValue(value);
        }
        break;
      case "height":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).height = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          (node.shapeData as ImageData).height = getNumericValue(value);
        }
        break;

      case "rx":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).rx = getNumericValue(value);
        } else if (node.shapeData.type === "ellipse") {
          (node.shapeData as EllipseData).rx = getNumericValue(value);
        }
        break;
      case "ry":
        if (node.shapeData.type === "rect") {
          (node.shapeData as RectData).ry = getNumericValue(value);
        } else if (node.shapeData.type === "ellipse") {
          (node.shapeData as EllipseData).ry = getNumericValue(value);
        }
        break;

      // Per-corner radii (CSS border-radius longhands). Each seeds a full
      // cornerRadii tuple (from the uniform rx if it isn't there yet) so a
      // single corner declaration still yields a well-defined four-corner rect.
      case "border-top-left-radius":
        setCornerRadius(node, 0, getNumericValue(value));
        break;
      case "border-top-right-radius":
        setCornerRadius(node, 1, getNumericValue(value));
        break;
      case "border-bottom-right-radius":
        setCornerRadius(node, 2, getNumericValue(value));
        break;
      case "border-bottom-left-radius":
        setCornerRadius(node, 3, getNumericValue(value));
        break;

      // Circle/ellipse properties
      case "cx":
        if (node.shapeData.type === "circle") {
          const d = node.shapeData as CircleData;
          d.cx = getNumericValue(value);
          d.__cxSet = true;
        } else if (node.shapeData.type === "ellipse") {
          const d = node.shapeData as EllipseData;
          d.cx = getNumericValue(value);
          d.__cxSet = true;
        } else if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).cx = getNumericValue(value);
        }
        break;
      case "cy":
        if (node.shapeData.type === "circle") {
          const d = node.shapeData as CircleData;
          d.cy = getNumericValue(value);
          d.__cySet = true;
        } else if (node.shapeData.type === "ellipse") {
          const d = node.shapeData as EllipseData;
          d.cy = getNumericValue(value);
          d.__cySet = true;
        } else if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).cy = getNumericValue(value);
        }
        break;
      case "r":
        if (node.shapeData.type === "circle") {
          (node.shapeData as CircleData).r = getNumericValue(value);
        }
        break;

      // Star / polygon geometry. Synthesized into a path at render time; `sides`
      // is static, the rest are animatable (see the registry).
      case "sides":
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).sides = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "outer-radius":
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).outerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "inner-radius":
        if (node.shapeData.type === "star") {
          (node.shapeData as PolystarData).innerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "rotation":
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).rotation = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "outer-roundness":
        if (isPolystar(node.shapeData)) {
          (node.shapeData as PolystarData).outerRoundness =
            getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "inner-roundness":
        if (node.shapeData.type === "star") {
          (node.shapeData as PolystarData).innerRoundness =
            getNumericValue(value);
          node.polystarDirty = true;
        }
        break;

      // Path
      case "d":
        if (node.shapeData.type === "path") {
          const pathStr = getStringValue(value);
          (node.shapeData as PathData).d = pathStr;
          (node.shapeData as PathData).commands = parsePath(pathStr);
        }
        break;

      // Appearance
      case "fill": {
        const paint = this.parsePaint(value);
        if (paint?.type === "gradient") {
          // Invalid gradient falls back to no fill.
          node.fillGradient = paint.gradient;
          node.fill = null;
        } else if (paint) {
          node.fill = paint.color;
        }
        break;
      }

      case "stroke": {
        const paint = this.parsePaint(value);
        if (paint?.type === "gradient") {
          node.strokeGradient = paint.gradient;
          node.stroke = null;
        } else if (paint) {
          node.stroke = paint.color;
        }
        break;
      }

      case "clip-path":
        node.clipPath = this.parseClipPath(value);
        break;

      case "mask":
        this.parseMask(node, value);
        break;

      // CSS filter: one or more space-separated filter functions (blur,
      // drop-shadow, color-adjust). The whole list is animatable via the
      // registry's `filter` handler.
      case "filter":
        node.filter = this.parseFilter(value);
        break;

      // CSS box-shadow: a comma-separated list of shadows, each parsed to a
      // drop-shadow FilterOp (with spread/inset). Animatable via the registry's
      // `box-shadow` handler (same interpolateFilter path as `filter`).
      case "box-shadow":
        node.boxShadow = this.parseBoxShadow(value);
        break;

      // CSS mix-blend-mode. A recognized keyword sets the node's blend; an
      // unknown one is ignored (stays 'normal') — every CSS mode is mappable, so
      // there's nothing to drop-with-warning beyond a typo.
      case "mix-blend-mode":
        if (isKeywordValue(value) && BLEND_MODES.has(value.value)) {
          node.mixBlendMode = value.value as BlendMode;
        }
        break;

      // CSS Motion Path. offset-path is static (cached arc-length table built
      // once); offset-distance is animatable (registry) so it also lands here as
      // the authored default; offset-rotate is static.
      case "offset-path":
        if (isFunctionValue(value) && value.name === "path") {
          const arg = value.args[0];
          if (arg && isStringValue(arg)) {
            node.offsetPath = buildMotionPath(parsePath(arg.value));
          }
        }
        break;
      case "offset-distance":
        node.offsetDistance = clamp01(normalizeFraction(value));
        break;
      case "offset-rotate":
        node.offsetRotate = this.parseOffsetRotate(value);
        break;

      case "stroke-width":
        node.strokeWidth = getNumericValue(value);
        break;

      case "stroke-linecap":
        if (
          isKeywordValue(value) &&
          (value.value === "butt" ||
            value.value === "round" ||
            value.value === "square")
        ) {
          node.strokeLineCap = value.value;
        }
        break;

      case "stroke-linejoin":
        if (
          isKeywordValue(value) &&
          (value.value === "miter" ||
            value.value === "round" ||
            value.value === "bevel")
        ) {
          node.strokeLineJoin = value.value;
        }
        break;

      case "stroke-miterlimit":
        node.strokeMiterLimit = getNumericValue(value);
        break;

      // Stroke dashing: a repeating length list, plus an animatable offset.
      case "stroke-dasharray":
        node.strokeDashArray = isListValue(value)
          ? value.values.map(getNumericValue)
          : [getNumericValue(value)];
        break;
      case "stroke-dashoffset":
        node.strokeDashOffset = getNumericValue(value);
        break;

      case "fill-rule":
        if (
          isKeywordValue(value) &&
          (value.value === "nonzero" || value.value === "evenodd")
        ) {
          node.fillRule = value.value;
        }
        break;

      // SVG-style paint order. Only 'stroke' (stroke behind fill) is meaningful
      // here; any other value keeps the default fill-then-stroke.
      case "paint-order":
        if (isKeywordValue(value)) {
          node.paintOrder = value.value === "stroke" ? "stroke" : "normal";
        }
        break;

      // CSS pointer-events (subset): `none` removes this node and its subtree
      // from hit-testing. Static keyword; not animatable / state-overridable.
      case "pointer-events":
        if (isKeywordValue(value)) {
          node.pointerEvents = value.value === "none" ? "none" : "auto";
        }
        break;

      // CSS cursor (subset): `pointer` marks the node interactive (so it is
      // hit-tested and clicks credit it) and flags it so the component sets the
      // canvas cursor to `pointer` on hover. Static keyword; not animatable.
      case "cursor":
        if (isKeywordValue(value) && value.value === "pointer") {
          node.cursorPointer = true;
          node.interactive = true;
        }
        break;

      // Trim paths: percentages normalized to 0..1 (like opacity is authored as
      // a fraction) and clamped to range.
      case "trim-start":
        node.trimStart = clamp01(normalizeFraction(value));
        break;
      case "trim-end":
        node.trimEnd = clamp01(normalizeFraction(value));
        break;
      case "trim-offset":
        node.trimOffset = clamp01(normalizeFraction(value));
        break;

      case "opacity":
        node.opacity = getNumericValue(value);
        break;

      // Per-subtree time scoping (static). time-offset shifts the local
      // timeline later; time-scale compresses/stretches it. Applied to this
      // node and its descendants during the render walk.
      case "time-offset":
        node.timeOffset =
          isLengthValue(value) && value.unit === "s"
            ? value.value * 1000
            : getNumericValue(value); // ms (bare number or 'ms')
        break;
      case "time-scale": {
        const scale = getNumericValue(value);
        if (scale > 0) {
          node.timeScale = scale;
        } else {
          console.warn(`time-scale must be > 0, got ${scale}; using 1`);
          node.timeScale = 1;
        }
        break;
      }

      // Time remap. A comma-separated list of `<input-time> <output-time>
      // [easing]` stops maps the subtree's inherited time through a monotonic
      // curve (the general form of time-offset/scale). A lone bare `<time>` is a
      // constant remap: the scalar path that pins local time and that
      // @keyframes/`:state()` animate (see the `time-remap` registry entry).
      case "time-remap": {
        const curve = this.parseTimeRemap(value);
        if (curve) node.timeRemap = curve;
        else {
          const ms = timeMs(value);
          if (ms !== null) node.timeRemapValue = ms;
        }
        break;
      }

      // Sibling paint order. See childrenInPaintOrder. A var()/@keyframes value
      // rides the numeric registry `z-index` handler (bindable/animatable).
      case "z-index":
        node.zIndex = Math.round(getNumericValue(value));
        break;

      // display: `none` removes the node + subtree from render + hit-test; any
      // other ident (block, …) is visible (CSS). A var()/input()/@keyframes value
      // toggles it through the numeric registry `display` handler (0 => none).
      case "display":
        node.displayNone = isKeywordValue(value) && value.value === "none";
        break;

      // Visibility window (static). Stored in ms; the resolve walk compares it
      // against the inherited (parent-scope) time, before this node's own
      // time-offset/time-scale apply.
      case "visible-from":
        node.visibleFrom =
          isLengthValue(value) && value.unit === "s"
            ? value.value * 1000
            : getNumericValue(value); // ms (bare number or 'ms')
        break;
      case "visible-until":
        node.visibleUntil =
          isLengthValue(value) && value.unit === "s"
            ? value.value * 1000
            : getNumericValue(value); // ms (bare number or 'ms')
        break;

      // The `animation` shorthand and all `animation-*` longhands are resolved
      // together (composed per CSS) by resolveAnimations after this pass.
      case "animation":
      case "animation-name":
      case "animation-duration":
      case "animation-timing-function":
      case "animation-iteration-count":
      case "animation-direction":
      case "animation-delay":
      case "animation-fill-mode":
        break;
    }

    // Initialize shape data if not set
    this.ensureShapeData(node);
  }

  private ensureShapeData(node: SceneNode): void {
    if (!node.shapeData || node.shapeData.type !== node.type) {
      switch (node.type) {
        case "group":
          node.shapeData = { type: "group" };
          break;
        case "rect":
          node.shapeData = {
            type: "rect",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rx: 0,
            ry: 0,
          };
          break;
        case "circle":
          node.shapeData = { type: "circle", cx: 0, cy: 0, r: 0 };
          break;
        case "ellipse":
          node.shapeData = { type: "ellipse", cx: 0, cy: 0, rx: 0, ry: 0 };
          break;
        case "path":
          node.shapeData = { type: "path", d: "", commands: [] };
          break;
        case "star":
        case "polygon":
          node.shapeData = {
            type: node.type,
            sides: 5,
            outerRadius: 0,
            innerRadius: 0,
            rotation: 0,
            cx: 0,
            cy: 0,
            outerRoundness: 0,
            innerRoundness: 0,
          };
          break;
        case "text":
          node.shapeData = {
            type: "text",
            x: 0,
            y: 0,
            content: "",
            fontSize: 16,
            fontFamily: "sans-serif",
            fontWeight: "normal",
            anchor: "start",
            letterSpacing: 0,
            lineHeight: 0,
          };
          break;
        case "image":
          node.shapeData = {
            type: "image",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            src: "",
            viewBox: null,
          };
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
      const firstVal = this.parseTransformOriginValue(values[0], "x");
      if (firstVal) {
        // Check if it's a y-axis keyword used as first value (e.g., "top")
        if (this.isYAxisKeyword(values[0])) {
          origin.y = firstVal;
          // If single y-axis keyword, x defaults to center (50%)
          origin.x = { value: 50, unit: "%" };
        } else {
          origin.x = firstVal;
        }
      }
    }

    // Process second value (y-axis)
    if (values.length >= 2) {
      const secondVal = this.parseTransformOriginValue(values[1], "y");
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
      if (isKeywordValue(firstVal) && firstVal.value === "center") {
        // "center" alone means center on both axes
        origin.x = { value: 50, unit: "%" };
        origin.y = { value: 50, unit: "%" };
      } else if (!this.isYAxisKeyword(firstVal)) {
        // Single x-axis value defaults y to 50% (center)
        // This matches CSS behavior where "transform-origin: 100px" means "100px 50%"
        origin.y = { value: 50, unit: "%" };
      }
    }

    node.transform.transformOrigin = origin;
  }

  private isYAxisKeyword(value: Value): boolean {
    return (
      isKeywordValue(value) &&
      (value.value === "top" || value.value === "bottom")
    );
  }

  private parseTransformOriginValue(
    value: Value,
    axis: "x" | "y",
  ): TransformOriginValue | null {
    if (isKeywordValue(value)) {
      return this.keywordToOriginValue(value.value, axis);
    } else if (isLengthValue(value)) {
      if (value.unit === "%") {
        return { value: value.value, unit: "%" };
      } else {
        // Convert all other units to px (simplified)
        return { value: value.value, unit: "px" };
      }
    } else if (isNumberValue(value)) {
      // Plain numbers treated as pixels
      return { value: value.value, unit: "px" };
    }
    return null;
  }

  private keywordToOriginValue(
    keyword: string,
    _axis: "x" | "y",
  ): TransformOriginValue {
    switch (keyword) {
      case "left":
        return { value: 0, unit: "%" };
      case "right":
        return { value: 100, unit: "%" };
      case "top":
        return { value: 0, unit: "%" };
      case "bottom":
        return { value: 100, unit: "%" };
      case "center":
        return { value: 50, unit: "%" };
      default:
        // Unknown keyword defaults to 0
        return { value: 0, unit: "px" };
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
  private resolveAnimations(
    node: SceneNode,
    declarations: Declaration[],
    sib: SiblingContext = ROOT_SIBLING,
  ): void {
    for (const a of this.buildAnimations(declarations, false, node.id, sib))
      node.animations.push(a);
  }

  /**
   * Compose a declaration set's `animation`/`animation-*` into concrete
   * AnimationInstance[] (the shared logic behind node-level animations and a
   * `:state()` block's own animations). See resolveAnimations for the CSS
   * composition rules.
   *
   * `stateDefault` is set for `:state()` animations: when the author didn't
   * write a fill mode, they default to `both` (hold the first frame before the
   * entry delay and the last frame after completion) rather than the node-level
   * `forwards`. That matches how stateful runtimes (Rive/dotLottie) treat a
   * one-shot state animation — it holds its end frame for as long as the state
   * stays active, instead of snapping back to base.
   */
  private buildAnimations(
    declarations: Declaration[],
    stateDefault = false,
    nodeId = "",
    sib: SiblingContext = ROOT_SIBLING,
  ): AnimationInstance[] {
    let slots: AnimSlot[] | null = null;
    // Grow (creating default slots) so a longhand seen before any shorthand can
    // still define animations positionally.
    const ensure = (n: number): AnimSlot[] => {
      slots ??= [];
      while (slots.length < n) slots.push(defaultAnimSlot());
      return slots;
    };
    const eachSlot = (
      v: Value,
      fn: (slot: AnimSlot, val: Value) => void,
    ): void => {
      const vals = commaValues(v);
      const s = ensure(vals.length);
      for (let i = 0; i < s.length; i++) fn(s[i], vals[i % vals.length]);
    };

    for (const decl of declarations) {
      switch (decl.property) {
        case "animation": {
          // Shorthand resets the whole animation list.
          const groups =
            isListValue(decl.value) && decl.value.separator === "comma"
              ? decl.value.values
              : [decl.value];
          slots = groups.map((g) =>
            this.parseAnimationGroup(isListValue(g) ? g.values : [g]),
          );
          break;
        }
        case "animation-name":
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) || isStringValue(v)) slot.name = v.value;
          });
          break;
        case "animation-duration":
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) {
              slot.duration = ms;
              slot.durationSet = true;
            }
          });
          break;
        case "animation-delay":
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) slot.delay = ms;
          });
          break;
        case "animation-timing-function":
          eachSlot(decl.value, (slot, v) => {
            slot.timingFunction = this.timingFromValue(v);
          });
          break;
        case "animation-iteration-count":
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v) && v.value === "infinite")
              slot.iterationCount = Infinity;
            else if (isNumberValue(v)) slot.iterationCount = v.value;
          });
          break;
        case "animation-direction":
          eachSlot(decl.value, (slot, v) => {
            if (
              isKeywordValue(v) &&
              (v.value === "normal" ||
                v.value === "reverse" ||
                v.value === "alternate" ||
                v.value === "alternate-reverse")
            ) {
              slot.direction = v.value;
            }
          });
          break;
        case "animation-fill-mode":
          eachSlot(decl.value, (slot, v) => {
            if (
              isKeywordValue(v) &&
              (v.value === "none" ||
                v.value === "forwards" ||
                v.value === "backwards" ||
                v.value === "both")
            ) {
              slot.fillMode = v.value;
              slot.fillModeSet = true;
            }
          });
          break;
        // Not part of the `animation` shorthand (which resets it to 'replace').
        case "animation-composition":
          eachSlot(decl.value, (slot, v) => {
            if (
              isKeywordValue(v) &&
              (v.value === "replace" ||
                v.value === "add" ||
                v.value === "accumulate")
            ) {
              slot.composition = v.value;
            }
          });
          break;
      }
    }

    if (!slots) return [];
    const out: AnimationInstance[] = [];
    for (const slot of slots) {
      if (slot.name && this.keyframesMap.has(slot.name)) {
        out.push({
          name: slot.name,
          duration: slot.duration,
          timingFunction: slot.timingFunction,
          iterationCount: slot.iterationCount,
          direction: slot.direction,
          delay: slot.delay,
          fillMode: stateDefault && !slot.fillModeSet ? "both" : slot.fillMode,
          composition: slot.composition,
          keyframes: this.buildKeyframes(
            this.keyframesMap.get(slot.name)!,
            nodeId,
            sib,
          ),
        });
      }
    }
    return out;
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
    const eachSlot = (
      v: Value,
      fn: (slot: TransSlot, val: Value) => void,
    ): void => {
      const vals = commaValues(v);
      const s = ensure(vals.length);
      for (let i = 0; i < s.length; i++) fn(s[i], vals[i % vals.length]);
    };

    for (const decl of declarations) {
      switch (decl.property) {
        case "transition": {
          const groups =
            isListValue(decl.value) && decl.value.separator === "comma"
              ? decl.value.values
              : [decl.value];
          slots = groups.map((g) =>
            this.parseTransitionGroup(isListValue(g) ? g.values : [g]),
          );
          break;
        }
        case "transition-property":
          eachSlot(decl.value, (slot, v) => {
            if (isKeywordValue(v)) slot.property = v.value;
          });
          break;
        case "transition-duration":
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) slot.duration = ms;
          });
          break;
        case "transition-delay":
          eachSlot(decl.value, (slot, v) => {
            const ms = timeMs(v);
            if (ms !== null) slot.delay = ms;
          });
          break;
        case "transition-timing-function":
          eachSlot(decl.value, (slot, v) => {
            slot.easing = this.timingFromValue(v);
          });
          break;
      }
    }

    if (!slots) return [];
    return slots
      .filter((s) => s.duration > 0)
      .map((s) => ({
        property: s.property,
        duration: s.duration,
        easing: s.easing,
        delay: s.delay,
      }));
  }

  /** Parse one `transition` shorthand group: `<property> <dur> [<easing>] [<delay>]`. */
  private parseTransitionGroup(values: Value[]): TransSlot {
    const slot = defaultTransSlot();
    let durationSet = false;
    for (const raw of values) {
      const v = this.resolveStaticVars(raw);
      if (isLengthValue(v) && (v.unit === "s" || v.unit === "ms")) {
        const ms = timeMs(v)!;
        if (!durationSet) {
          slot.duration = ms;
          durationSet = true;
        } else slot.delay = ms;
      } else if (isFunctionValue(v) && this.isTimingFunctionName(v.name)) {
        slot.easing = this.timingFromFunction(v);
      } else if (isKeywordValue(v)) {
        const kw = v.value;
        if (
          kw === "linear" ||
          kw === "ease" ||
          kw === "ease-in" ||
          kw === "ease-out" ||
          kw === "ease-in-out" ||
          kw === "step-start" ||
          kw === "step-end"
        ) {
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
    for (const raw of values) {
      // Resolve a `var(--e)` easing to its static `:root` definition so a
      // hoisted cubic-bezier in the shorthand behaves like the inline form.
      const v = this.resolveStaticVars(raw);
      if (isKeywordValue(v)) {
        const kw = v.value;
        if (this.keyframesMap.has(kw)) slot.name = kw;
        else if (
          kw === "linear" ||
          kw === "ease" ||
          kw === "ease-in" ||
          kw === "ease-out" ||
          kw === "ease-in-out" ||
          kw === "step-start" ||
          kw === "step-end"
        )
          slot.timingFunction = kw;
        else if (kw === "infinite") slot.iterationCount = Infinity;
        else if (
          kw === "normal" ||
          kw === "reverse" ||
          kw === "alternate" ||
          kw === "alternate-reverse"
        )
          slot.direction = kw;
        else if (
          kw === "none" ||
          kw === "forwards" ||
          kw === "backwards" ||
          kw === "both"
        ) {
          slot.fillMode = kw;
          slot.fillModeSet = true;
        }
      } else if (isFunctionValue(v) && this.isTimingFunctionName(v.name)) {
        slot.timingFunction = this.timingFromFunction(v);
      } else if (isLengthValue(v)) {
        // Time values are assigned by order (CSS rule): first duration, second delay.
        const ms = timeMs(v);
        if (ms !== null) {
          if (!slot.durationSet) {
            slot.duration = ms;
            slot.durationSet = true;
          } else slot.delay = ms;
        }
      } else if (isNumberValue(v)) {
        if (v.value === Math.floor(v.value) && v.value > 0 && v.value < 100)
          slot.iterationCount = v.value;
      } else if (isStringValue(v)) {
        slot.name = v.value;
      }
    }
    return slot;
  }

  private isTimingFunctionName(name: string): boolean {
    return name === "cubic-bezier" || name === "steps" || name === "linear";
  }

  /** Resolve a timing-function FunctionValue (cubic-bezier(), steps(), linear()). */
  private timingFromFunction(v: FunctionValue): TimingFunction {
    if (v.name === "cubic-bezier") return this.parseCubicBezierFunction(v);
    if (v.name === "steps") return this.parseStepsFunction(v);
    if (v.name === "linear") return this.parseLinearFunction(v);
    return "ease";
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
      else if (isLengthValue(arg) && arg.unit === "%" && raw.length > 0) {
        raw[raw.length - 1].inputs.push(arg.value / 100);
      }
    }
    const pts: { input: number | null; output: number }[] = [];
    for (const s of raw) {
      if (s.inputs.length === 0) pts.push({ input: null, output: s.output });
      else for (const input of s.inputs) pts.push({ input, output: s.output });
    }
    const points = normalizeLinearPoints(pts);
    if (points.length < 2) return "linear";
    return { type: "linear", points };
  }

  /**
   * Parse `steps(<count>, <position>?)`. Position defaults to jump-end; the CSS
   * `start`/`end` aliases map to jump-start/jump-end. The parser flattens the
   * function args, so they arrive as [<number count>, <keyword position>?].
   */
  private parseStepsFunction(func: FunctionValue): TimingFunction {
    let count = 1;
    let position: StepPosition = "jump-end";
    for (const arg of func.args) {
      if (isNumberValue(arg)) count = Math.max(1, Math.round(arg.value));
      else if (isKeywordValue(arg)) {
        const p = arg.value;
        if (p === "start") position = "jump-start";
        else if (p === "end") position = "jump-end";
        else if (
          p === "jump-start" ||
          p === "jump-end" ||
          p === "jump-none" ||
          p === "jump-both"
        )
          position = p;
      }
    }
    return { type: "steps", count, position };
  }

  /**
   * Resolve any timing-function value (named keyword or a function). One path
   * shared by the `animation` shorthand, the `animation-timing-function`
   * longhand, and per-keyframe easing, so the DSL accepts the same easing syntax
   * everywhere.
   */
  private timingFromValue(rawV: Value): TimingFunction {
    // A `var(--e)` easing resolves to its static `:root` definition (a
    // cubic-bezier()/steps()/linear() function) before dispatch, so hoisted
    // easing custom properties animate identically to the inline form.
    const v = this.resolveStaticVars(rawV);
    if (isFunctionValue(v) && this.isTimingFunctionName(v.name))
      return this.timingFromFunction(v);
    if (
      isKeywordValue(v) &&
      (v.value === "linear" ||
        v.value === "ease" ||
        v.value === "ease-in" ||
        v.value === "ease-out" ||
        v.value === "ease-in-out" ||
        v.value === "step-start" ||
        v.value === "step-end")
    ) {
      return v.value;
    }
    return "ease";
  }

  private buildKeyframes(
    rule: KeyframeRule,
    nodeId = "",
    sib: SiblingContext = ROOT_SIBLING,
  ): KeyframeData[] {
    const frames = rule.blocks.flatMap((block) => {
      const properties = this.buildKeyframeProperties(block, nodeId, sib);
      // Per-keyframe easing, resolved through the one shared timing-function
      // path so keyframes accept the same easing syntax as the animation
      // shorthand/longhand.
      const easing = block.easing
        ? this.timingFromValue(block.easing)
        : undefined;
      // A selector list (`0%, 100% { ... }`) applies the same declarations at
      // every listed offset — expand to one keyframe per offset, exactly as if
      // the author had written separate blocks (repeated offsets follow the
      // same last-wins sampling as two literal blocks would).
      return block.selectors.map((selector) => {
        const keyframeData: KeyframeData = {
          offset: selector / 100,
          properties,
        };
        if (easing) keyframeData.easing = easing;
        return keyframeData;
      });
    });
    // Author order isn't guaranteed ascending (`100% {} 0% {}` is legal CSS);
    // sort once here so per-frame sampling can trust the order.
    frames.sort((a, b) => a.offset - b.offset);
    warnIncompatibleObjectKeyframes(rule.name, frames);
    return frames;
  }

  private buildKeyframeProperties(
    block: KeyframeBlock,
    nodeId = "",
    sib: SiblingContext = ROOT_SIBLING,
  ): Record<string, AnimatableValue> {
    const props: Record<string, AnimatableValue> = {};

    for (const decl of block.declarations) {
      const { property } = decl;
      // Resolve static `:root` var() refs (dedup) before keyframe parsing, so a
      // hoisted `d:`/`clip-path:` morph target reaches parsePath, not an empty
      // command list. Keyframes are a separate code path from applyDeclaration.
      // A random() endpoint is frozen here against the owning node (per-element
      // rolls per instance sharing this @keyframes); default sharing keys to the
      // call site, so all instances get the same endpoint.
      // sibling-index()/sibling-count() resolve per instance sharing this
      // @keyframes, before resolveStaticVars folds the now-static calc() to a
      // literal endpoint (mirrors how per-element random freezes below).
      const withSibling = valueHasSiblingFn(decl.value)
        ? foldSiblingFns(decl.value, sib)
        : decl.value;
      const resolved = this.resolveStaticVars(withSibling);
      const value = valueHasRandom(resolved)
        ? freezeRandom(resolved, {
            documentSeed: this.documentSeed(),
            nodeId,
            property,
          })
        : resolved;

      switch (property) {
        case "transform":
          // Store individual transform properties instead of full Transform
          // This allows merging with base transform during interpolation
          this.extractTransformProperties(value, props);
          break;
        case "translate":
        case "rotate":
        case "scale":
          // CSS individual transform properties animate the same channels.
          extractIndividualTransform(property, value, (key, val) => {
            props[key] = val;
          });
          break;
        default: {
          // Every other animatable property carries a single endpoint value,
          // parsed the same way here and in state-block overrides.
          const parsed = this.parseAnimatableValue(property, value);
          if (parsed !== undefined) props[property] = parsed;
        }
      }
    }

    return props;
  }

  /**
   * Parse one declaration value into its animatable endpoint, for the properties
   * that carry a single value (i.e. everything except the multi-channel
   * transform/translate/rotate/scale forms). Shared by keyframe building and
   * state-block overrides so both accept identical per-property syntax: trim and
   * offset-distance normalize to 0..1 fractions, `d`/clip-path parse to command
   * lists, fill/stroke to color-or-gradient, filter to its blur radius, and
   * anything else to a raw number or string. `undefined` = nothing usable to
   * store (caller leaves the property untouched).
   */
  private parseAnimatableValue(
    property: string,
    value: Value,
  ): PropValue | undefined {
    switch (property) {
      case "opacity":
        return getNumericValue(value);
      case "trim-start":
      case "trim-end":
      case "trim-offset":
      case "offset-distance":
        // Store normalized 0..1 so interpolation stays in range.
        return normalizeFraction(value);
      case "time-remap": {
        // Scalar remap target in ms (s -> ms), feeding node.timeRemapValue.
        const ms = timeMs(value);
        return ms ?? (isNumberValue(value) ? value.value : undefined);
      }
      case "fill":
      case "stroke": {
        // A gradient endpoint parses to structured GradientData (animated
        // stops); a plain color parses to its string. Both are animatable.
        const paint = this.parsePaint(value);
        if (paint?.type === "gradient") return paint.gradient ?? undefined;
        if (paint?.color != null) return paint.color;
        return undefined;
      }
      case "d":
        // Path morphing: parse the path string to commands once at build.
        return parsePath(getStringValue(value));
      case "clip-path": {
        // Animated clip (Lottie animated masks): only the path() variant
        // morphs — reuse parseClipPath, then carry its command list as the
        // path-kind value (circle/inset aren't command-morphable).
        const clip = this.parseClipPath(value);
        return clip && clip.type === "path" ? clip.commands : undefined;
      }
      case "filter":
        // The whole filter list is the animatable endpoint; the registry lerps
        // each op's numerics when two endpoints share the same function sequence
        // (else replace). See interpolateFilter.
        return this.parseFilter(value) ?? undefined;
      case "box-shadow":
        // Same object-endpoint contract as filter — a shadow list morphs when
        // the two endpoints share the same length/inset structure.
        return this.parseBoxShadow(value) ?? undefined;
      case "object-view-box":
        // Sprite crop rect. Endpoints are concrete {x,y,w,h}; the registry lerps
        // each component (so steps() timing pages discrete source rects). `none`
        // yields no usable endpoint (leave the base untouched).
        return extractImageViewBox(value) ?? undefined;
      default:
        // Raw numeric/string value (geometry, dash offset, font-size, …).
        if (isNumberValue(value) || isLengthValue(value))
          return getNumericValue(value);
        if (
          isColorValue(value) ||
          isKeywordValue(value) ||
          isStringValue(value)
        )
          return getStringValue(value);
        return undefined;
    }
  }

  private extractTransformProperties(
    value: Value,
    props: Record<string, AnimatableValue>,
  ): void {
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
    value: Value,
  ):
    | { type: "gradient"; gradient: GradientData | null }
    | { type: "color"; color: string | null }
    | null {
    if (isFunctionValue(value) && GRADIENT_FN.has(value.name)) {
      return { type: "gradient", gradient: this.parseGradient(value) };
    }
    // Named colors normalize to canonical hex at build time (so animation
    // endpoints are already hex); transparent/currentColor/unknown keywords and
    // rgb()/hsl() all flow through the shared color helper. `none` -> no paint.
    if (isKeywordValue(value) && value.value === "none") {
      return { type: "color", color: null };
    }
    const color = colorStringFromValue(value);
    if (color !== null) return { type: "color", color };
    return null;
  }

  private parseGradient(func: {
    name: string;
    args: Value[];
  }): GradientData | null {
    // `repeating-<kind>()` tiles the stop run; otherwise the kind carries through.
    const repeating = func.name.startsWith("repeating-");
    const kind = repeating ? func.name.slice("repeating-".length) : func.name;
    const isLinear = kind === "linear-gradient";
    const isConic = kind === "conic-gradient";
    const args = func.args;
    let i = 0;

    const num = (v?: Value): number | null =>
      v && (isLengthValue(v) || isNumberValue(v)) ? v.value : null;

    // CSS default linear direction is `to bottom` (180deg).
    let angle = 180;
    if (
      isLinear &&
      args.length > 0 &&
      isLengthValue(args[0]) &&
      args[0].unit === "deg"
    ) {
      angle = args[0].value;
      i = 1;
    }

    // `at <x>px <y>px` — sweep/radial centre in local space; shared by conic and
    // radial, so it is declared before both keyword loops.
    let at: { x: number; y: number } | undefined;

    // conic-gradient([from <angle>] [at <x>px <y>px], stops...). `from` is a
    // single start angle (0 = up, clockwise); `at` is the sweep centre in local
    // space (px, mirroring radial `at`), defaulting to the box centre.
    let fromAngle = 0;
    if (isConic) {
      while (i < args.length && isKeywordValue(args[i])) {
        const kw = (args[i] as { value: string }).value;
        if (kw === "from" && args[i + 1] && num(args[i + 1]) != null) {
          fromAngle = num(args[i + 1])!;
          i += 2;
          continue;
        }
        if (kw === "at") {
          const x = num(args[i + 1]);
          const y = num(args[i + 2]);
          if (x != null && y != null) {
            at = { x, y };
            i += 3;
            continue;
          }
        }
        break;
      }
    }

    // Explicit geometry keywords lead the arg list (from the Lottie converter):
    //   linear-gradient(from <x>px <y>px to <x>px <y>px, stops...)
    //   radial-gradient(circle <r>px at <cx>px <cy>px [from <fx>px <fy>px], stops...)
    // Coordinates are in the shape's local space; `from` is endpoint for linear,
    // focal (inner-circle center) for radial.
    let from: { x: number; y: number } | undefined;
    let to: { x: number; y: number } | undefined;
    let radius: number | undefined;
    let focal: { x: number; y: number } | undefined;
    while (!isConic && i < args.length && isKeywordValue(args[i])) {
      const kw = (args[i] as { value: string }).value;
      const x = num(args[i + 1]);
      if (kw === "circle" && x != null) {
        radius = x;
        i += 2;
        continue;
      }
      const y = num(args[i + 2]);
      if (kw === "at" && x != null && y != null) {
        at = { x, y };
        i += 3;
        continue;
      }
      if (kw === "to" && x != null && y != null) {
        to = { x, y };
        i += 3;
        continue;
      }
      if (kw === "from" && x != null && y != null) {
        if (isLinear) from = { x, y };
        else focal = { x, y };
        i += 3;
        continue;
      }
      break; // unknown keyword — leave it for the stop loop to skip
    }

    const stops: GradientStop[] = [];
    while (i < args.length) {
      const color = this.colorArgToString(args[i++]);
      if (color === null) continue; // skip anything that isn't a color
      let offset: number | null = null;
      const next = args[i];
      // Stop position: `%` for every kind, plus `deg` for conic (fraction of the
      // full turn) so `red 90deg` reads as CSS does.
      if (next && isLengthValue(next) && next.unit === "%") {
        offset = next.value / 100;
        i++;
      } else if (
        isConic &&
        next &&
        isLengthValue(next) &&
        next.unit === "deg"
      ) {
        offset = next.value / 360;
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

    if (isConic)
      return { type: "conic-gradient", from: fromAngle, stops, at, repeating };
    return isLinear
      ? { type: "linear-gradient", angle, stops, from, to, repeating }
      : { type: "radial-gradient", stops, radius, at, focal, repeating };
  }

  private colorArgToString(value: Value): string | null {
    return colorStringFromValue(value);
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
        if (isFunctionValue(v) && v.name === "path") {
          const arg = v.args[0];
          if (arg && isStringValue(arg)) commands.push(...parsePath(arg.value));
        }
      }
      return commands.length > 0 ? { type: "path", commands } : null;
    }

    if (!isFunctionValue(value)) return null;

    if (value.name === "circle") {
      // Args: [r, keyword 'at', x, y] — collect the numeric ones in order.
      const nums = value.args
        .filter((a) => isLengthValue(a) || isNumberValue(a))
        .map(getNumericValue);
      if (nums.length === 0) return null;
      return { type: "circle", r: nums[0], x: nums[1] ?? 0, y: nums[2] ?? 0 };
    }

    if (value.name === "inset") {
      const nums = value.args
        .filter((a) => isLengthValue(a) || isNumberValue(a))
        .map(getNumericValue);
      if (nums.length === 0) return null;
      // CSS shorthand: 1 -> all, 2 -> (t/b, l/r), 4 -> t r b l.
      const top = nums[0];
      const right = nums[1] ?? top;
      const bottom = nums[2] ?? top;
      const left = nums[3] ?? right;
      return { type: "inset", top, right, bottom, left };
    }

    if (value.name === "path") {
      const arg = value.args[0];
      if (arg && isStringValue(arg)) {
        return { type: "path", commands: parsePath(arg.value) };
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
    let mode: MaskMode = "alpha";
    for (const v of values) {
      // A hex-digit-only id (`#fade`, `#cafe`) lexes as a color token; a literal
      // color is never valid in `mask:`, so a color here is always an id reference.
      if (isColorValue(v) && v.value.startsWith("#")) {
        sourceId = v.value.slice(1);
        continue;
      }
      if (!isKeywordValue(v)) continue;
      if (v.value.startsWith("#")) {
        sourceId = v.value.slice(1);
      } else if (
        v.value === "alpha" ||
        v.value === "alpha-invert" ||
        v.value === "luminance" ||
        v.value === "luminance-invert"
      ) {
        mode = v.value;
      }
    }
    if (sourceId) this.pendingMasks.push({ node, sourceId, mode });
  }

  /**
   * Parse a CSS `filter` value: a space-separated list of filter functions.
   * Supported: blur(), drop-shadow(), and the single-scalar color-adjust
   * functions brightness/contrast/saturate/grayscale/sepia/invert/opacity/
   * hue-rotate. Any other function is ignored. Returns null when nothing usable
   * is found.
   *   blur(<length>)
   *   drop-shadow(<dx> <dy> <blur>? <color>?)  — color defaults to black (CSS
   *   defaults to currentcolor, which Popkorn has no concept of).
   *   brightness(<number|percent>)  etc.  — omitted arg defaults to 1 (0 for
   *   hue-rotate); a percent normalizes to its fraction so amount is always a
   *   plain multiplier. hue-rotate's amount is an angle in degrees.
   */
  private parseFilter(value: Value): FilterOp[] | null {
    const fns = isListValue(value) ? value.values : [value];
    const ops: FilterOp[] = [];
    // A color-adjust scalar: percent -> fraction (50% => 0.5), else the number.
    const frac = (v: Value | undefined, dflt: number): number => {
      if (!v) return dflt;
      if (isLengthValue(v) && v.unit === "%") return getNumericValue(v) / 100;
      return getNumericValue(v);
    };
    for (const v of fns) {
      if (!isFunctionValue(v)) continue;
      if (v.name === "blur") {
        ops.push({
          type: "blur",
          radius: v.args[0] ? getNumericValue(v.args[0]) : 0,
        });
      } else if (
        v.name === "brightness" ||
        v.name === "contrast" ||
        v.name === "saturate" ||
        v.name === "grayscale" ||
        v.name === "sepia" ||
        v.name === "invert" ||
        v.name === "opacity"
      ) {
        ops.push({ type: v.name, amount: frac(v.args[0], 1) });
      } else if (v.name === "hue-rotate") {
        // NOTE: angle read in degrees; turn/rad units aren't unwound here.
        ops.push({
          type: "hue-rotate",
          amount: v.args[0] ? getNumericValue(v.args[0]) : 0,
        });
      } else if (v.name === "drop-shadow") {
        // Parser flattens the space-separated args to a bare list: lengths in
        // dx/dy/blur order, plus an optional color anywhere.
        const lengths: number[] = [];
        let color = "#000000";
        for (const a of v.args) {
          if (isLengthValue(a) || isNumberValue(a))
            lengths.push(getNumericValue(a));
          else {
            const c = colorStringFromValue(a);
            if (c) color = c;
          }
        }
        ops.push({
          type: "drop-shadow",
          dx: lengths[0] ?? 0,
          dy: lengths[1] ?? 0,
          blur: lengths[2] ?? 0,
          color,
        });
      }
    }
    return ops.length ? ops : null;
  }

  /**
   * Parse CSS box-shadow into drop-shadow FilterOps. Syntax per shadow:
   * `[inset] <dx> <dy> [<blur>] [<spread>] [<color>]`, comma-separated for a
   * multi-shadow stack. Lengths are read in dx/dy/blur/spread order; the color
   * (any supported form) may sit anywhere; a bare `inset` keyword flags it. CSS
   * paints the FIRST listed shadow on top, which is the FilterOp order the
   * renderer walks (front-to-back), so we keep source order.
   */
  private parseBoxShadow(value: Value): FilterOp[] | null {
    if (isKeywordValue(value) && value.value === "none") return null;
    // A comma-separated value is a list with separator 'comma'; each group is
    // itself a space list (or a lone value for a one-part shadow).
    const groups =
      isListValue(value) && value.separator === "comma"
        ? value.values
        : [value];
    const ops: FilterOp[] = [];
    for (const g of groups) {
      const parts = isListValue(g) ? g.values : [g];
      const lengths: number[] = [];
      let color = "#000000";
      let inset = false;
      for (const p of parts) {
        if (isKeywordValue(p) && p.value === "inset") {
          inset = true;
        } else if (isLengthValue(p) || isNumberValue(p)) {
          lengths.push(getNumericValue(p));
        } else {
          const c = colorStringFromValue(p);
          if (c) color = c;
        }
      }
      // dx/dy are required in CSS; a shadow with neither is inert — skip it.
      if (lengths.length < 2) continue;
      ops.push({
        type: "drop-shadow",
        dx: lengths[0],
        dy: lengths[1],
        blur: lengths[2] ?? 0,
        spread: lengths[3] ?? 0,
        color,
        inset,
      });
    }
    return ops.length ? ops : null;
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
      if (isKeywordValue(v) && v.value === "auto") {
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

  /**
   * Replace static `:root` var() references with their definitions, recursing
   * into function args and list values. A var() is left untouched when it has no
   * :root definition, or when that definition is itself reactive (contains
   * another var() or an `input()`) — those keep flowing to the numeric binding
   * path, preserving the per-frame resolution order (base → bindings → animation
   * → hover). This is what makes hoisted `path()` dedup resolve at build time.
   */
  private resolveStaticVars(value: Value): Value {
    if (isVariableRefValue(value)) {
      const resolved = this.variablesMap.get(value.name);
      if (resolved) {
        if (this.hasVariableReference(resolved)) return value;
        return this.resolveStaticVars(resolved);
      }
      // Undefined var: fall back to the authored fallback (if static).
      if (value.fallback && !this.hasVariableReference(value.fallback)) {
        return this.resolveStaticVars(value.fallback);
      }
      return value;
    }
    if (isFunctionValue(value)) {
      if (value.name === "input") return value; // reactive; leave args alone
      let changed = false;
      const args = value.args.map((a) => {
        const r = this.resolveStaticVars(a);
        if (r !== a) changed = true;
        return r;
      });
      return changed ? { ...value, args } : value;
    }
    if (isListValue(value)) {
      let changed = false;
      const values = value.values.map((v) => {
        const r = this.resolveStaticVars(v);
        if (r !== v) changed = true;
        return r;
      });
      return changed ? { ...value, values } : value;
    }
    if (isCalcValue(value)) {
      // Resolve static :root vars inside the operands, then fold the whole
      // expression to a literal when nothing reactive remains — so static (and
      // static-var) calc() reaches every downstream reader as a plain
      // length/number, animation-delay/duration included. A calc() that still
      // holds a reactive var()/input() stays a calc and flows to the numeric
      // binding path (resolved per frame — see VariableResolver.resolveValue).
      const resolved = {
        type: "calc" as const,
        expr: mapCalcOperands(value.expr, (v) => this.resolveStaticVars(v)),
      };
      if (!this.hasVariableReference(resolved)) {
        return evalCalcStatic(resolved) ?? resolved;
      }
      return resolved;
    }
    return value;
  }

  private hasVariableReference(value: Value): boolean {
    // Check if the value is a variable reference (var())
    if (isVariableRefValue(value)) {
      return true;
    }

    // Check if it's an input() function
    if (isFunctionValue(value) && value.name === "input") {
      return true;
    }

    // Check list values recursively
    if (isListValue(value)) {
      return value.values.some((v) => this.hasVariableReference(v));
    }

    // Recurse into calc() operands.
    if (isCalcValue(value)) {
      return calcOperands(value.expr).some((v) => this.hasVariableReference(v));
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
    const items =
      isListValue(value) && value.separator === "comma"
        ? value.values
        : [value];
    const stops: TimeRemapStop[] = [];
    for (const item of items) {
      const parts = isListValue(item) ? item.values : [item];
      let input: number | null = null;
      let output: number | null = null;
      let easing: TimingFunction | undefined;
      for (const p of parts) {
        if (isLengthValue(p) && (p.unit === "s" || p.unit === "ms")) {
          const ms = p.unit === "s" ? p.value * 1000 : p.value;
          if (input === null) input = ms;
          else if (output === null) output = ms;
        } else if (isNumberValue(p)) {
          const ms = p.value; // bare number = ms
          if (input === null) input = ms;
          else if (output === null) output = ms;
        } else if (isFunctionValue(p) && p.name === "cubic-bezier") {
          easing = this.parseCubicBezierFunction(p);
        } else if (isKeywordValue(p) && p.value === "step-end") {
          easing = "step-end";
        } else if (
          isKeywordValue(p) &&
          (p.value === "linear" ||
            p.value === "ease" ||
            p.value === "ease-in" ||
            p.value === "ease-out" ||
            p.value === "ease-in-out")
        ) {
          easing = p.value;
        }
      }
      if (input !== null && output !== null)
        stops.push({ input, output, easing });
    }
    if (stops.length === 0) return null;
    stops.sort((a, b) => a.input - b.input);
    return stops;
  }

  private parseCubicBezierFunction(func: {
    name: string;
    args: Value[];
  }): TimingFunction {
    if (func.args.length >= 4) {
      return {
        type: "cubic-bezier",
        x1: getNumericValue(func.args[0]),
        y1: getNumericValue(func.args[1]),
        x2: getNumericValue(func.args[2]),
        y2: getNumericValue(func.args[3]),
      };
    }
    return "ease";
  }
}

export function buildSceneGraph(stylesheet: StyleSheet): SceneNode {
  const builder = new SceneBuilder();
  return builder.build(stylesheet);
}

// A rule minus its `repeat:` declaration (values are read-only during build, so
// the array is filtered in place of a deep copy).
function stripRepeatDecl(rule: Rule): Rule {
  return {
    ...rule,
    declarations: rule.declarations.filter((d) => d.property !== "repeat"),
  };
}

// Clone a rule tree, appending `suffix` to every id selector in it — the top id
// and every descendant id (nested children AND state-block children), so a
// `repeat:` copy's whole subtree stays unique and per-copy targetable
// (`#field-2`'s child `#arm` -> `#arm-2`). Class selectors are left alone; this
// runs before `use:` expansion, so symbol internals get namespaced under the
// already-suffixed instance id in the copy's own buildNode.
function suffixRuleIds(rule: Rule, suffix: string): Rule {
  const selector =
    rule.selector.type === "id"
      ? { ...rule.selector, name: rule.selector.name + suffix }
      : rule.selector;
  return {
    ...rule,
    selector,
    children: rule.children.map((c) => suffixRuleIds(c, suffix)),
    states: rule.states.map((s) => ({
      ...s,
      children: s.children.map((c) => suffixRuleIds(c, suffix)),
    })),
  };
}

// A rule that only sets properties on an existing node — no `type:`/`use:` and no
// children of its own. Such a rule targeting a repeat copy's id is a per-copy
// override; one that establishes a node (type/use/children) is a distinct node
// and thus an id collision.
function isPureOverride(rule: Rule): boolean {
  return (
    rule.children.length === 0 &&
    !rule.declarations.some(
      (d) => d.property === "type" || d.property === "use",
    )
  );
}

// `repeat:` is instance context; a @define template may not carry it anywhere in
// its body (declarations or any descendant rule).
function assertNoRepeatInDefinition(def: DefinitionRule): void {
  const scan = (decls: Declaration[], children: Rule[]): void => {
    if (decls.some((d) => d.property === "repeat")) {
      throw new Error(
        `repeat: is not allowed inside @define '${def.name}' — put it on the node that use:s the symbol`,
      );
    }
    for (const c of children) scan(c.declarations, c.children);
  };
  scan(def.declarations, def.children);
}

// After `repeat:` expansion, two nodes sharing an id means a derived id collided
// with an explicitly-declared node (or another copy) — reject it, matching the
// per-copy-targetable identity contract.
function assertUniqueIds(root: SceneNode): void {
  const seen = new Set<string>();
  const visit = (n: SceneNode): void => {
    if (n.id) {
      if (seen.has(n.id)) {
        throw new Error(
          `duplicate node id '#${n.id}' — a repeat-derived id collides with another node`,
        );
      }
      seen.add(n.id);
    }
    n.children.forEach(visit);
  };
  root.children.forEach(visit);
}

// Deep-clone a definition child rule, namespacing every id in the subtree under
// the instance's id (e.g. `tail` under `spark1` -> `spark1.tail`) so multiple
// instances of the same symbol never share scene-node ids.
function namespaceChild(rule: Rule, prefix: string): Rule {
  const name = `${prefix}.${rule.selector.name}`;
  return {
    type: "rule",
    selector: { ...rule.selector, name },
    declarations: rule.declarations, // values are read-only during build
    children: rule.children.map((c) => namespaceChild(c, name)),
    states: rule.states,
    span: rule.span,
    preludeSpan: rule.preludeSpan,
  };
}

// Find the direct child a state-child selector targets, by id or class. Ids
// built under a @define instance are namespaced (`inst.child`), so an id
// selector also matches the un-namespaced tail — a `&:hover > #child` inside a
// symbol still resolves after instantiation.
function findDirectChild(
  parent: SceneNode,
  selector: Selector,
): SceneNode | undefined {
  if (selector.type === "class") {
    return parent.children.find((c) => c.className === selector.name);
  }
  return parent.children.find(
    (c) => c.id === selector.name || c.id.endsWith("." + selector.name),
  );
}

// Merge state blocks: a use-site block replaces the definition's for the same pseudo.
function mergeStates(
  defStates: StateRule[],
  useStates: StateRule[],
): StateRule[] {
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
function normalizeLinearPoints(
  pts: { input: number | null; output: number }[],
): LinearEasingPoint[] {
  const n = pts.length;
  if (n === 0) return [];
  if (pts[0].input == null) pts[0].input = 0;
  if (pts[n - 1].input == null) pts[n - 1].input = 1;
  let largest = pts[0].input as number;
  for (const p of pts) {
    if (p.input != null) {
      largest = Math.max(largest, p.input);
      p.input = largest;
    }
  }
  let i = 0;
  while (i < n) {
    if (pts[i].input == null) {
      let j = i;
      while (j < n && pts[j].input == null) j++;
      const prev = pts[i - 1].input as number;
      const next = pts[j].input as number;
      const span = j - i + 1;
      for (let k = i; k < j; k++)
        pts[k].input = prev + ((next - prev) * (k - i + 1)) / span;
      i = j;
    } else i++;
  }
  return pts as LinearEasingPoint[];
}

// A percentage (50%) becomes 0.5; a bare number (0.5) is taken as-is. Used for
// trim-* props, which are fractions of the outline length.
function normalizeFraction(value: Value): number {
  if (isLengthValue(value) && value.unit === "%") return value.value / 100;
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
  fillModeSet: boolean;
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
  return { property: "all", duration: 0, easing: "ease", delay: 0 };
}

// fill-mode defaults to 'forwards' (not CSS's 'none') so scenes hold their final
// frame; every other field is the CSS initial value.
function defaultAnimSlot(): AnimSlot {
  return {
    name: "",
    duration: 1000,
    durationSet: false,
    timingFunction: "ease",
    iterationCount: 1,
    direction: "normal",
    delay: 0,
    fillMode: "forwards",
    fillModeSet: false,
    composition: "replace",
  };
}

// A comma-separated animation longhand splits into per-animation values; a bare
// value is a single-element list.
function commaValues(value: Value): Value[] {
  return isListValue(value) && value.separator === "comma"
    ? value.values
    : [value];
}

// Every leaf Value in a calc() expression tree (left→right).
function calcOperands(expr: CalcExpr): Value[] {
  if (expr.type === "calc-operand") return [expr.value];
  if (expr.type === "calc-function") return expr.args.flatMap(calcOperands);
  return [...calcOperands(expr.left), ...calcOperands(expr.right)];
}

// Rebuild a calc() expression tree, mapping each leaf Value through `fn`.
function mapCalcOperands(expr: CalcExpr, fn: (v: Value) => Value): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: fn(expr.value) };
  if (expr.type === "calc-function")
    return {
      type: "calc-function",
      name: expr.name,
      args: expr.args.map((a) => mapCalcOperands(a, fn)),
    };
  return {
    type: "calc-binary",
    op: expr.op,
    left: mapCalcOperands(expr.left, fn),
    right: mapCalcOperands(expr.right, fn),
  };
}

// Time value (`s`/`ms`) to milliseconds, or null when it isn't a time.
// NOTE: only STATIC calc() folds here — animation timing is baked at build, so a
// calc() with a reactive var()/input() operand can't re-evaluate per frame (like
// a bare var() in timing, which is also unsupported). Reactive calc works on the
// per-frame numeric property bindings instead; lifting it into timing would mean
// a live-retimed scheduler, out of scope.
function timeMs(value: Value): number | null {
  if (isCalcValue(value)) {
    const folded = evalCalcStatic(value);
    return folded ? timeMs(folded) : null;
  }
  if (!isLengthValue(value)) return null;
  return value.unit === "s"
    ? value.value * 1000
    : value.unit === "ms"
      ? value.value
      : null;
}
