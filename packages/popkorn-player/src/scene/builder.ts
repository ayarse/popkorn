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
import { buildKeyframeTracks } from "../animation/keyframes.js";
import type { PropValue } from "../animation/registry.js";
import {
  getPropHandler,
  gradientsCompatible,
  pathsCompatible,
} from "../animation/registry.js";
import type { HueMethod } from "../renderer/oklab.js";
import type {
  GradientData,
  GradientInterpolation,
  GradientStop,
  PathCommand,
} from "../renderer/types.js";
import { isGradientData } from "../renderer/types.js";
import { colorStringFromValue } from "./color.js";
import { buildMotionPath, parsePath } from "./path-parser.js";
import { freezeRandom, hashString, valueHasRandom } from "./random.js";
import type { SiblingContext } from "./sibling.js";
import { foldSiblingFns, valueHasSiblingFn } from "./sibling.js";
import { clamp01 } from "./transform.js";
import type {
  AnimatableValue,
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  BlendMode,
  ClipPathData,
  CompositeOperation,
  FilterOp,
  ImageViewBox,
  KeyframeData,
  KeyframeTrack,
  LinearEasingPoint,
  MaskMode,
  PolystarData,
  PropertyBinding,
  SceneNode,
  ShapeData,
  ShapeType,
  StateStyles,
  StepPosition,
  TextAnchor,
  TimeRemapStop,
  TimingFunction,
  Transform,
  TransformOriginValue,
  TransitionSpec,
} from "./types.js";
import {
  createDefaultTransformOrigin,
  createSceneNode,
  snapshotNode,
} from "./types.js";

// State-block props consumed elsewhere (transition*/animation*); not warned.
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

const isPolystar = (sd: ShapeData): sd is PolystarData =>
  sd.type === "star" || sd.type === "polygon";

// Set one corner (0=tl,1=tr,2=br,3=bl), seeding the tuple from the uniform rx.
function setCornerRadius(node: SceneNode, index: number, value: number): void {
  if (node.shapeData.type !== "rect") return;
  const rect = node.shapeData;
  const seed = rect.rx || 0;
  const c: [number, number, number, number] = rect.cornerRadii
    ? [...rect.cornerRadii]
    : [seed, seed, seed, seed];
  c[index] = value;
  rect.cornerRadii = c;
}

// CSS gradient functions accepted as fill/stroke paint (all via parseGradient).
export const GRADIENT_FN = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

// Static :root var() folds at build only here; elsewhere var() stays a live binding.
const STRUCTURAL_FOLD_PROPERTIES = new Set([
  "d",
  "offset-path",
  "clip-path",
  "mask",
]);

// State-overridable strings; shapeData-backed so resetNodeToBase reverts them.
const STATE_STRING_PROPERTIES = new Set([
  "content",
  "font-family",
  "font-weight",
  "text-anchor",
  "text-align",
]);

// Strings a var() may drive; re-applied via applyDeclaration each frame.
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

// Warn once per animation whose gradient/path keyframes step, not interpolate.
const warnedAnimations = new Set<string>();
const OBJECT_VALUED_PROPS = new Set(["fill", "stroke", "d", "clip-path"]);
function warnIncompatibleObjectKeyframes(
  name: string,
  tracks: KeyframeTrack[],
): void {
  for (const track of tracks) {
    const prop = track.property;
    if (!OBJECT_VALUED_PROPS.has(prop)) continue;
    for (let i = 0; i < track.stops.length - 1; i++) {
      const a = track.stops[i].value;
      const b = track.stops[i + 1].value;
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

type TransformKey =
  | "translateX"
  | "translateY"
  | "rotate"
  | "scaleX"
  | "scaleY"
  | "skewX"
  | "skewY";

// Report each transform channel to `set`; bindings pass a live `resolve`.
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

// `translate`/`rotate`/`scale` props → transform channels; false otherwise.
// NOTE: shares channels with `transform:` (last wins), not CSS's layering.
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

// `object-view-box: xywh(x y w h)` → source-crop rect; null = whole bitmap.
// NOTE: `inset()` unsupported; its edges need the decoded intrinsic size.
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

// True when an object-view-box operand is reactive (per-frame binding).
function objectViewBoxHasVariable(value: Value): boolean {
  const argHasVar = (v: Value): boolean =>
    isVariableRefValue(v) ||
    (isFunctionValue(v) && v.name === "input") ||
    (isCalcValue(v) && calcOperands(v.expr).some(argHasVar));
  return isFunctionValue(value) && value.args.some(argHasVar);
}

// True when a transform operand is reactive; the loop re-extracts per frame.
function transformHasVariable(value: Value): boolean {
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

class SceneBuilder {
  private keyframesMap: Map<string, KeyframeRule> = new Map();
  private definitionsMap: Map<string, DefinitionRule> = new Map();
  // Static :root custom properties for build-time var() folding.
  private variablesMap: Map<string, Value> = new Map();
  // Authored `mask:` refs, resolved once the whole tree exists.
  private pendingMasks: {
    node: SceneNode;
    sourceId: string;
    mode: MaskMode;
  }[] = [];
  // Document seed for random(), hashed lazily from the canonical serialization.
  private sheet: StyleSheet | null = null;
  private docSeed: number | null = null;
  // Gates the post-build id-uniqueness check to scenes that instanced.
  private usedRepeat = false;

  build(stylesheet: StyleSheet): SceneNode {
    this.sheet = stylesheet;
    for (const kf of stylesheet.keyframes) {
      this.keyframesMap.set(kf.name, kf);
    }
    for (const def of stylesheet.definitions) {
      this.definitionsMap.set(def.name, def);
    }
    for (const v of stylesheet.variables) {
      this.variablesMap.set(v.name, v.value);
    }
    for (const def of stylesheet.definitions) {
      assertNoRepeatInDefinition(def);
    }

    const root = createSceneNode("root", "group");

    this.buildSiblings(stylesheet.rules, root);

    if (this.usedRepeat) assertUniqueIds(root);

    this.resolveMasks(root);
    this.unTrapMaskedContent(root);

    // Machine pointer-trigger targets must be interactive for the hit-tester.
    root.machines = stylesheet.machines;
    this.markPointerTargets(root, stylesheet.machines);

    return root;
  }

  // Flag `on <pointer>(#id)` targets interactive; matches namespaced tails.
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

  // Resolve `mask:` refs by id; the source then paints only as a mask.
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

  // Content nested in its own mask source never paints; split S out a `-matte`.
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

  private buildNode(rule: Rule, sib: SiblingContext): SceneNode {
    rule = this.expandUse(rule);

    const id = rule.selector.name;
    // Freeze random() now; keyframes freeze per-node in buildKeyframes.
    rule = this.freezeRandomInRule(rule, id);
    // Fold sibling-index()/sibling-count() the same way.
    rule = this.foldSiblingInRule(rule, sib);
    let shapeType: ShapeType = "group";

    for (const decl of rule.declarations) {
      if (decl.property === "type") {
        shapeType = getStringValue(decl.value) as ShapeType;
        break;
      }
    }

    const node = createSceneNode(id, shapeType);
    // Materialize shapeData first so declaration order doesn't matter.
    this.ensureShapeData(node);

    if (rule.selector.type === "class") {
      node.className = id;
    }

    this.applyDeclarations(node, rule.declarations);

    // circle/ellipse `x`/`y` box sugar → cx/cy, once r/rx/ry are final.
    this.resolveCircleEllipseBoxPosition(node);

    // `animation` + longhands compose per CSS (later wins per sub-property).
    this.resolveAnimations(node, rule.declarations, sib);

    node.transitions = this.resolveTransitions(rule.declarations);

    // State-child rules (`&:hover > #c`) wait until the children exist.
    const stateChildRules: { rule: Rule; state: "hover" | "active" }[] = [];
    const machineChildRules: {
      rule: Rule;
      machineState: { machine: string | null; name: string };
    }[] = [];
    if (rule.states && rule.states.length > 0) {
      for (const stateRule of rule.states) {
        if (stateRule.state === "state") {
          // `:state()` block; unlike hover/active it may carry `animation:`.
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
        // hover/active makes it hit-testable; `:state()` isn't pointer-driven.
        node.interactive = true;
      }
    }

    this.buildSiblings(rule.children, node);

    // The parent's state flip drives each target child (interaction.ts).
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

    // Machine state is global, so these merge into the child's own stateStyles.
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

    // Immutable base for the per-frame value-resolution pipeline.
    node.base = snapshotNode(node);

    return node;
  }

  private documentSeed(): number {
    this.docSeed ??= hashString(serialize(this.sheet as StyleSheet));
    return this.docSeed;
  }

  // Freeze random() in own declarations + state blocks, keyed by node id.
  // NOTE: `&:hover > #c` blocks freeze/fold against the parent, not #c.
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

  // Fold sibling-index()/-count() in a rule's own declarations + state blocks.
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

  // Expand `repeat:`, then build siblings indexed against the expanded list.
  private buildSiblings(rules: Rule[], parent: SceneNode): void {
    const expanded: Rule[] = [];
    const derived = new Set<string>();
    for (const rule of rules) this.expandRepeat(rule, expanded, derived);

    // A pure-property rule naming a copy (`#field-3 {…}`) folds onto it.
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

  // `repeat: <n>` → N copies with `-1`…`-N` suffixed ids (descendants too).
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

  // The `repeat:` count or null; static only (the tree is fixed over time).
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

  // Merge a `use:` definition into the use-site (which wins); detects cycles.
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
      // Def first so use-site declarations win; `use` itself is dropped.
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

  // Shared by a node's own &:hover/&:active and state-child rules.
  private buildStateStyles(declarations: Declaration[]): StateStyles {
    const styles: StateStyles = {};

    for (const decl of declarations) {
      const { property, value } = decl;

      switch (property) {
        case "fill": {
          // Channels are exclusive; applyStateStyles clears the other.
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
          // Merge into the same channel deltas (last wins per channel).
          styles.transform ??= {};
          const t = styles.transform;
          extractIndividualTransform(property, value, (key, val) => {
            t[key] = val;
          });
          break;
        }

        default: {
          // Registry-animatable props snap; handlers set dirty flags (#3).
          const value = this.resolveStaticVars(decl.value);
          if (STATE_STRING_PROPERTIES.has(property)) {
            styles.discrete ??= [];
            styles.discrete.push((n) =>
              this.applyDeclaration(n, { ...decl, value }),
            );
          } else if (getPropHandler(property)) {
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

  private extractStateTransform(value: Value): Partial<Transform> {
    const transform: Partial<Transform> = {};
    extractTransform(value, (key, val) => {
      transform[key] = val;
    });
    return transform;
  }

  // circle/ellipse `x`/`y` box sugar → `cx = x + r`; explicit cx/cy wins.
  private resolveCircleEllipseBoxPosition(node: SceneNode): void {
    if (node.shapeData.type === "circle") {
      const d = node.shapeData;
      if (d.__boxX !== undefined && !d.__cxSet) d.cx = d.__boxX + d.r;
      if (d.__boxY !== undefined && !d.__cySet) d.cy = d.__boxY + d.r;
      delete d.__boxX;
      delete d.__boxY;
      delete d.__cxSet;
      delete d.__cySet;
    } else if (node.shapeData.type === "ellipse") {
      const d = node.shapeData;
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
    const value = STRUCTURAL_FOLD_PROPERTIES.has(property)
      ? this.resolveStaticVars(decl.value)
      : decl.value;

    // Live 0..1 scrub source, kept unresolved so var() stays overridable.
    if (property === "animation-timeline") {
      node.animationTimeline = decl.value;
      return;
    }

    if (this.hasVariableReference(value)) {
      const binding: PropertyBinding = { property, value };
      // String props re-apply the resolved value through this switch each frame.
      if (STRING_BINDABLE_PROPERTIES.has(property)) {
        binding.applyString = (n, resolved) =>
          this.applyDeclaration(n, { ...decl, value: resolved });
      }
      node.bindings.push(binding);
      return;
    }

    switch (property) {
      // A reactive operand registers a per-frame binding instead.
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
          node.shapeData.x = getNumericValue(value);
        } else if (node.shapeData.type === "text") {
          node.shapeData.x = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.x = getNumericValue(value);
        } else if (
          node.shapeData.type === "circle" ||
          node.shapeData.type === "ellipse"
        ) {
          // NOTE: box sugar, see resolveCircleEllipseBoxPosition; static.
          node.shapeData.__boxX = getNumericValue(value);
        }
        break;
      case "y":
        if (node.shapeData.type === "rect") {
          node.shapeData.y = getNumericValue(value);
        } else if (node.shapeData.type === "text") {
          node.shapeData.y = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.y = getNumericValue(value);
        } else if (
          node.shapeData.type === "circle" ||
          node.shapeData.type === "ellipse"
        ) {
          node.shapeData.__boxY = getNumericValue(value);
        }
        break;

      // Text content, or image source (`content: url('…')`).
      case "content":
        if (node.shapeData.type === "text") {
          node.shapeData.content = getStringValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.src = this.imageSrc(value);
        }
        break;

      // xywh() skips the hasVariableReference check above; bind here.
      case "object-view-box":
        if (node.shapeData.type === "image") {
          if (objectViewBoxHasVariable(value)) {
            node.bindings.push({ property, value });
          } else {
            node.shapeData.viewBox = extractImageViewBox(value);
          }
        }
        break;
      case "font-size":
        if (node.shapeData.type === "text") {
          node.shapeData.fontSize = getNumericValue(value);
        }
        break;
      case "font-family":
        if (node.shapeData.type === "text") {
          // Rejoin fallback stacks; an empty family invalidates ctx.font.
          node.shapeData.fontFamily = isListValue(value)
            ? value.values.map(getStringValue).join(", ")
            : getStringValue(value);
        }
        break;
      case "font-weight":
        if (node.shapeData.type === "text") {
          // Keyword ('bold') or numeric weight (700) — store as a string for ctx.font.
          node.shapeData.fontWeight = isNumberValue(value)
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
          node.shapeData.anchor = value.value as TextAnchor;
        }
        break;
      // text-align → anchor: center→middle, right/end→end, else start.
      case "text-align":
        if (node.shapeData.type === "text" && isKeywordValue(value)) {
          const a =
            value.value === "center"
              ? "middle"
              : value.value === "right" || value.value === "end"
                ? "end"
                : "start";
          node.shapeData.anchor = a;
        }
        break;
      case "letter-spacing":
        if (node.shapeData.type === "text") {
          node.shapeData.letterSpacing = getNumericValue(value);
          node.textBoundsDirty = true;
        }
        break;
      // px/% resolve against font-size; unitless is a multiplier.
      // NOTE: resolved once; doesn't track an animated font-size.
      case "line-height":
        if (node.shapeData.type === "text") {
          const t = node.shapeData;
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
          node.shapeData.width = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.width = getNumericValue(value);
        }
        break;
      case "height":
        if (node.shapeData.type === "rect") {
          node.shapeData.height = getNumericValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.height = getNumericValue(value);
        }
        break;

      case "rx":
        if (node.shapeData.type === "rect") {
          node.shapeData.rx = getNumericValue(value);
        } else if (node.shapeData.type === "ellipse") {
          node.shapeData.rx = getNumericValue(value);
        }
        break;
      case "ry":
        if (node.shapeData.type === "rect") {
          node.shapeData.ry = getNumericValue(value);
        } else if (node.shapeData.type === "ellipse") {
          node.shapeData.ry = getNumericValue(value);
        }
        break;

      // CSS border-radius longhands.
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

      case "cx":
        if (node.shapeData.type === "circle") {
          const d = node.shapeData;
          d.cx = getNumericValue(value);
          d.__cxSet = true;
        } else if (node.shapeData.type === "ellipse") {
          const d = node.shapeData;
          d.cx = getNumericValue(value);
          d.__cxSet = true;
        } else if (isPolystar(node.shapeData)) {
          node.shapeData.cx = getNumericValue(value);
        }
        break;
      case "cy":
        if (node.shapeData.type === "circle") {
          const d = node.shapeData;
          d.cy = getNumericValue(value);
          d.__cySet = true;
        } else if (node.shapeData.type === "ellipse") {
          const d = node.shapeData;
          d.cy = getNumericValue(value);
          d.__cySet = true;
        } else if (isPolystar(node.shapeData)) {
          node.shapeData.cy = getNumericValue(value);
        }
        break;
      case "r":
        if (node.shapeData.type === "circle") {
          node.shapeData.r = getNumericValue(value);
        }
        break;

      // Star/polygon geometry (path synthesized at render); `sides` is static.
      case "sides":
        if (isPolystar(node.shapeData)) {
          node.shapeData.sides = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "outer-radius":
        if (isPolystar(node.shapeData)) {
          node.shapeData.outerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "inner-radius":
        if (node.shapeData.type === "star") {
          node.shapeData.innerRadius = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "rotation":
        if (isPolystar(node.shapeData)) {
          node.shapeData.rotation = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "outer-roundness":
        if (isPolystar(node.shapeData)) {
          node.shapeData.outerRoundness = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;
      case "inner-roundness":
        if (node.shapeData.type === "star") {
          node.shapeData.innerRoundness = getNumericValue(value);
          node.polystarDirty = true;
        }
        break;

      case "d":
        if (node.shapeData.type === "path") {
          node.shapeData.commands = parsePath(getStringValue(value));
        }
        break;

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

      // Filter function list; the whole list animates via the registry.
      case "filter":
        node.filter = this.parseFilter(value);
        break;

      // Comma list of shadows → drop-shadow FilterOps (spread/inset).
      case "box-shadow":
        node.boxShadow = this.parseBoxShadow(value);
        break;

      // Unknown keywords are ignored (stay 'normal').
      case "mix-blend-mode":
        if (isKeywordValue(value) && BLEND_MODES.has(value.value)) {
          node.mixBlendMode = value.value as BlendMode;
        }
        break;

      // offset-path/offset-rotate are static; offset-distance is animatable.
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

      // Only 'stroke' (stroke behind fill) changes the default order.
      case "paint-order":
        if (isKeywordValue(value)) {
          node.paintOrder = value.value === "stroke" ? "stroke" : "normal";
        }
        break;

      // `none` removes the subtree from hit-testing.
      case "pointer-events":
        if (isKeywordValue(value)) {
          node.pointerEvents = value.value === "none" ? "none" : "auto";
        }
        break;

      // `pointer` makes the node interactive and sets the canvas cursor on hover.
      case "cursor":
        if (isKeywordValue(value) && value.value === "pointer") {
          node.cursorPointer = true;
          node.interactive = true;
        }
        break;

      // Trim percentages normalize to clamped 0..1 fractions.
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

      // Per-subtree time scoping of the inherited timeline.
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

      // Stop list → curve; a lone `<time>` is a constant, animatable remap.
      case "time-remap": {
        const curve = this.parseTimeRemap(value);
        if (curve) node.timeRemap = curve;
        else {
          const ms = timeMs(value);
          if (ms !== null) node.timeRemapValue = ms;
        }
        break;
      }

      // Sibling paint order (see childrenInPaintOrder).
      case "z-index":
        node.zIndex = Math.round(getNumericValue(value));
        break;

      // `none` hides render + hit-test; bindings drive it numerically (0 = none).
      case "display":
        node.displayNone = isKeywordValue(value) && value.value === "none";
        break;

      // Visibility window in ms, compared against the parent-scope time.
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
    }

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
          node.shapeData = { type: "path", commands: [] };
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

  // transform-origin: keywords, %, px, or mixed (`center 100px`).
  private applyTransformOrigin(node: SceneNode, value: Value): void {
    const origin = createDefaultTransformOrigin();

    let values: Value[] = [];
    if (isListValue(value)) {
      values = value.values;
    } else {
      values = [value];
    }

    if (values.length >= 1) {
      const firstVal = this.parseTransformOriginValue(values[0], "x");
      if (firstVal) {
        if (this.isYAxisKeyword(values[0])) {
          origin.y = firstVal;
          origin.x = { value: 50, unit: "%" };
        } else {
          origin.x = firstVal;
        }
      }
    }

    if (values.length >= 2) {
      const secondVal = this.parseTransformOriginValue(values[1], "y");
      if (secondVal) {
        if (this.isYAxisKeyword(values[0])) {
          origin.x = secondVal;
        } else {
          origin.y = secondVal;
        }
      }
    } else if (values.length === 1) {
      const firstVal = values[0];
      if (isKeywordValue(firstVal) && firstVal.value === "center") {
        origin.x = { value: 50, unit: "%" };
        origin.y = { value: 50, unit: "%" };
      } else if (!this.isYAxisKeyword(firstVal)) {
        // A lone x value defaults y to 50% (CSS: `100px` = `100px 50%`).
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
        // NOTE: non-% units are read as px.
        return { value: value.value, unit: "px" };
      }
    } else if (isNumberValue(value)) {
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
        return { value: 0, unit: "px" };
    }
  }

  // CSS composition: shorthand resets the list, longhands index positionally.
  private resolveAnimations(
    node: SceneNode,
    declarations: Declaration[],
    sib: SiblingContext,
  ): void {
    for (const a of this.buildAnimations(declarations, false, node.id, sib))
      node.animations.push(a);
  }

  // `stateDefault`: unset fill-mode is `both`, so :state() one-shots hold.
  private buildAnimations(
    declarations: Declaration[],
    stateDefault: boolean,
    nodeId: string,
    sib: SiblingContext,
  ): AnimationInstance[] {
    let slots: AnimSlot[] | null = null;
    // Grow so a longhand before any shorthand still defines slots.
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
          tracks: this.buildKeyframes(
            this.keyframesMap.get(slot.name)!,
            nodeId,
            sib,
          ),
        });
      }
    }
    return out;
  }

  // Compose `transition` + longhands like animations; drops zero durations.
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

  // `linear()`: each number opens a point, following %s are its inputs.
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

  // `steps(<count>, <position>?)`; `start`/`end` alias jump-start/jump-end.
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

  // The one easing path: shorthand, longhand and per-keyframe easing.
  private timingFromValue(rawV: Value): TimingFunction {
    // A static var() easing resolves to its :root function first.
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
    nodeId: string,
    sib: SiblingContext,
  ): KeyframeTrack[] {
    const frames = rule.blocks.flatMap((block) => {
      const properties = this.buildKeyframeProperties(block, nodeId, sib);
      const easing = block.easing
        ? this.timingFromValue(block.easing)
        : undefined;
      // `0%, 100% { … }` expands to one keyframe per offset.
      return block.selectors.map((selector) => {
        const keyframeData: KeyframeData = {
          offset: selector / 100,
          properties,
        };
        if (easing) keyframeData.easing = easing;
        return keyframeData;
      });
    });
    // One offset-sorted track per property.
    const tracks = buildKeyframeTracks(frames);
    warnIncompatibleObjectKeyframes(rule.name, tracks);
    return tracks;
  }

  private buildKeyframeProperties(
    block: KeyframeBlock,
    nodeId: string,
    sib: SiblingContext,
  ): Record<string, AnimatableValue> {
    const props: Record<string, AnimatableValue> = {};

    for (const decl of block.declarations) {
      const { property } = decl;
      // Fold sibling fns, then static var()s, then freeze random() per node.
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
          // Per-channel values so they merge with the base transform.
          this.extractTransformProperties(value, props);
          break;
        case "translate":
        case "rotate":
        case "scale":
          extractIndividualTransform(property, value, (key, val) => {
            props[key] = val;
          });
          break;
        default: {
          const parsed = this.parseAnimatableValue(property, value);
          if (parsed !== undefined) props[property] = parsed;
        }
      }
    }

    return props;
  }

  // Value → animatable endpoint (keyframes + state); undefined = untouched.
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
        // Gradient → GradientData, color → string; both animate.
        const paint = this.parsePaint(value);
        if (paint?.type === "gradient") return paint.gradient ?? undefined;
        if (paint?.color != null) return paint.color;
        return undefined;
      }
      case "d":
        // Path morphing: parse the path string to commands once at build.
        return parsePath(getStringValue(value));
      case "clip-path": {
        // Only a path() clip morphs (circle/inset aren't command lists).
        const clip = this.parseClipPath(value);
        return clip && clip.type === "path" ? clip.commands : undefined;
      }
      case "filter":
        // Lerps per op when function sequences match (interpolateFilter).
        return this.parseFilter(value) ?? undefined;
      case "box-shadow":
        // Morphs when both lists share length/inset structure.
        return this.parseBoxShadow(value) ?? undefined;
      case "object-view-box":
        // Concrete {x,y,w,h} lerps per component; `none` yields no endpoint.
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
    extractTransform(value, (key, val) => {
      props[key] = val;
    });
  }

  // Fill/stroke → gradient or color (either null if invalid/none); null if not paint.
  private parsePaint(
    value: Value,
  ):
    | { type: "gradient"; gradient: GradientData | null }
    | { type: "color"; color: string | null }
    | null {
    if (isFunctionValue(value) && GRADIENT_FN.has(value.name)) {
      return { type: "gradient", gradient: this.parseGradient(value) };
    }
    // Named colors normalize to hex at build, so endpoints are hex.
    if (isKeywordValue(value) && value.value === "none") {
      return { type: "color", color: null };
    }
    const color = colorStringFromValue(value);
    if (color !== null) return { type: "color", color };
    return null;
  }

  // Flattened gradient args → GradientData; null without color stops.
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

    // `in <space> [<method> hue]`, either side of the direction.
    // NOTE: only oklab/oklch are realized; other spaces degrade to sRGB.
    let interpolate: GradientInterpolation | undefined;
    const keywordAt = (k: number): string | null =>
      args[k] && isKeywordValue(args[k])
        ? (args[k] as { value: string }).value
        : null;
    const eatInterpolation = (): void => {
      if (keywordAt(i) !== "in") return;
      const space = keywordAt(i + 1);
      if (space === null) return;
      // Consume unrealized spaces too, so they aren't misread as colour stops.
      i += 2;
      if (space !== "oklab" && space !== "oklch") {
        if (keywordAt(i + 1) === "hue") i += 2;
        return;
      }
      let hue: HueMethod | undefined;
      const method = keywordAt(i);
      if (space === "oklch" && keywordAt(i + 1) === "hue") {
        if (
          method === "shorter" ||
          method === "longer" ||
          method === "increasing" ||
          method === "decreasing"
        ) {
          hue = method;
          i += 2;
        }
      }
      interpolate = { space, hue };
    };
    eatInterpolation();

    // CSS default linear direction is `to bottom` (180deg).
    let angle = 180;
    if (
      isLinear &&
      i === 0 &&
      args.length > 0 &&
      isLengthValue(args[0]) &&
      args[0].unit === "deg"
    ) {
      angle = args[0].value;
      i = 1;
    }
    eatInterpolation();

    // `at <x>px <y>px` centre, shared by conic and radial.
    let at: { x: number; y: number } | undefined;

    // conic: `from <angle>` (0 = up, clockwise), `at` defaults to the box centre.
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

    // Lottie geometry: linear `from/to`, radial `circle <r> at … [from <focal>]`.
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
      // `%` for every kind; conic also accepts `deg` (fraction of a turn).
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
      return {
        type: "conic-gradient",
        from: fromAngle,
        stops,
        at,
        repeating,
        interpolate,
      };
    return isLinear
      ? {
          type: "linear-gradient",
          angle,
          stops,
          from,
          to,
          repeating,
          interpolate,
        }
      : {
          type: "radial-gradient",
          stops,
          radius,
          at,
          focal,
          repeating,
          interpolate,
        };
  }

  private colorArgToString(value: Value): string | null {
    return colorStringFromValue(value);
  }

  // clip-path: circle(r at x y) | inset(t r b l) | path('d'); null = unclipped.
  private parseClipPath(value: Value): ClipPathData | null {
    // Space-separated path()s union (Lottie add-mode) as one nonzero path.
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

  // `mask: #<id> [alpha|luminance][-invert]`; resolved after build.
  private parseMask(node: SceneNode, value: Value): void {
    const values = isListValue(value) ? value.values : [value];
    let sourceId: string | null = null;
    let mode: MaskMode = "alpha";
    for (const v of values) {
      // A hex-like id (`#fade`) lexes as a color; mask takes no colors.
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

  // blur, drop-shadow (default black: no currentcolor), color-adjusts (% → 0..1).
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
        // Flattened args: lengths are dx/dy/blur, color anywhere.
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

  // box-shadow → drop-shadow FilterOps; source order = first paints on top.
  private parseBoxShadow(value: Value): FilterOp[] | null {
    if (isKeywordValue(value) && value.value === "none") return null;
    // Comma list of shadows, each a space list or a lone value.
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

  // offset-rotate: `auto` (default) | `<angle>` | `auto <angle>`.
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

  // Inline static :root var()s; reactive/undefined ones stay for bindings.
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
      // Fold static calc() to a literal; reactive ones stay per-frame.
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
    if (isVariableRefValue(value)) {
      return true;
    }

    if (isFunctionValue(value) && value.name === "input") {
      return true;
    }

    if (isListValue(value)) {
      return value.values.some((v) => this.hasVariableReference(v));
    }

    if (isCalcValue(value)) {
      return calcOperands(value.expr).some((v) => this.hasVariableReference(v));
    }

    return false;
  }

  // `time-remap` list of `<in> <out> [easing]` stops, sorted; null if none.
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

// A rule minus its `repeat:` declaration.
function stripRepeatDecl(rule: Rule): Rule {
  return {
    ...rule,
    declarations: rule.declarations.filter((d) => d.property !== "repeat"),
  };
}

// Suffix every id in a rule tree, state-block children included.
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

// No type/use/children: a per-copy override rather than a new node.
function isPureOverride(rule: Rule): boolean {
  return (
    rule.children.length === 0 &&
    !rule.declarations.some(
      (d) => d.property === "type" || d.property === "use",
    )
  );
}

// `repeat:` is instance context; a @define body may not carry it anywhere.
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

// Repeat-derived ids must not collide with any other node id.
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

// Namespace a definition child's ids under the instance (`spark1.tail`).
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

// Match by class or id; an id also matches a namespaced `@define` tail.
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

// Fill missing linear() inputs per CSS Easing L2.
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

// 50% → 0.5; a bare number is taken as-is.
function normalizeFraction(value: Value): number {
  // Fold calc() first so `calc(… * 100%)` keeps its percent unit.
  const v = isCalcValue(value) ? (evalCalcStatic(value) ?? value) : value;
  if (isLengthValue(v) && v.unit === "%") return v.value / 100;
  return getNumericValue(v);
}

// One animation's state while composing shorthand + longhands.
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

// One transition's state while composing shorthand + longhands.
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

// fill-mode defaults to 'forwards' (not CSS 'none'): scenes hold.
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

// Split a comma list; a bare value is a single-element list.
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
// NOTE: static calc() only; reactive timing needs a live scheduler.
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
