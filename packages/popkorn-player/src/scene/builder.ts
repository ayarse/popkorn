import type {
  Declaration,
  DefinitionRule,
  KeyframeBlock,
  KeyframeRule,
  Rule,
  Selector,
  StyleSheet,
  Value,
} from "@popkorn/parser";
import {
  getNumericValue,
  getStringValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isStringValue,
  serialize,
} from "@popkorn/parser";
import { buildKeyframeTracks } from "../animation/keyframes.js";
import type { PropValue } from "../animation/registry.js";
import {
  getPropHandler,
  gradientsCompatible,
  pathsCompatible,
} from "../animation/registry.js";
import type { PathCommand } from "../renderer/types.js";
import { isGradientData } from "../renderer/types.js";
import { clamp01 } from "./matrix.js";
import { createSceneNode, snapshotNode } from "./node.js";
import { buildMotionPath, parsePath } from "./path-parser.js";
import type { PendingMask } from "./post-build.js";
import {
  assertUniqueIds,
  markPointerTargets,
  resolveMasks,
  unTrapMaskedContent,
} from "./post-build.js";
import { freezeRandom, hashString, valueHasRandom } from "./random.js";
import {
  assertNoRepeatInDefinition,
  expandUse,
  idMatches,
  isPureOverride,
  mapRuleDecls,
  mergeStates,
  repeatCount,
  stripRepeatDecl,
  suffixRuleIds,
} from "./rule-expand.js";
import type { SiblingContext } from "./sibling.js";
import { foldSiblingFns, valueHasSiblingFn } from "./sibling.js";
import { hasVariableReference, resolveStaticVars } from "./static-vars.js";
import {
  buildAnimations,
  parseTimeRemap,
  resolveTransitions,
  timeMs,
  timingFromValue,
} from "./timing.js";
import {
  extractImageViewBox,
  extractIndividualTransform,
  extractTransform,
  parseTransformOrigin,
  transformHasVariable,
} from "./transform-values.js";
import type {
  AnimatableValue,
  KeyframeData,
  KeyframeTrack,
  PropertyBinding,
  SceneNode,
  ShapeData,
  ShapeType,
  StateStyles,
  Transform,
} from "./types.js";
import {
  BLEND_MODES,
  FILL_RULES,
  STROKE_LINE_CAPS,
  STROKE_LINE_JOINS,
  TEXT_ANCHORS,
} from "./types.js";
import {
  applyPaint,
  imageSrc,
  normalizeFraction,
  oneOf,
  parseBoxShadow,
  parseClipPath,
  parseFilter,
  parseMask,
  parseOffsetRotate,
  parsePaint,
} from "./value-parsers.js";

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

// Plain numeric shape props: shape type → shapeData field, plus a cache to dirty.
// circle/ellipse x/y land in box-sugar scratch (resolveCircleEllipseBoxPosition).
type NumericShapeProp = {
  fields: Partial<Record<ShapeType, string>>;
  dirty?: "textBoundsDirty" | "polystarDirty";
};
const polystar = (field: string) => ({ star: field, polygon: field });
const NUMERIC_SHAPE_PROPS = new Map<string, NumericShapeProp>([
  [
    "x",
    {
      fields: {
        rect: "x",
        text: "x",
        image: "x",
        circle: "__boxX",
        ellipse: "__boxX",
      },
    },
  ],
  [
    "y",
    {
      fields: {
        rect: "y",
        text: "y",
        image: "y",
        circle: "__boxY",
        ellipse: "__boxY",
      },
    },
  ],
  ["width", { fields: { rect: "width", image: "width" } }],
  ["height", { fields: { rect: "height", image: "height" } }],
  ["rx", { fields: { rect: "rx", ellipse: "rx" } }],
  ["ry", { fields: { rect: "ry", ellipse: "ry" } }],
  ["r", { fields: { circle: "r" } }],
  ["cx", { fields: { circle: "cx", ellipse: "cx", ...polystar("cx") } }],
  ["cy", { fields: { circle: "cy", ellipse: "cy", ...polystar("cy") } }],
  ["font-size", { fields: { text: "fontSize" } }],
  [
    "letter-spacing",
    { fields: { text: "letterSpacing" }, dirty: "textBoundsDirty" },
  ],
  ["sides", { fields: polystar("sides"), dirty: "polystarDirty" }],
  ["outer-radius", { fields: polystar("outerRadius"), dirty: "polystarDirty" }],
  ["inner-radius", { fields: { star: "innerRadius" }, dirty: "polystarDirty" }],
  ["rotation", { fields: polystar("rotation"), dirty: "polystarDirty" }],
  [
    "outer-roundness",
    { fields: polystar("outerRoundness"), dirty: "polystarDirty" },
  ],
  [
    "inner-roundness",
    { fields: { star: "innerRoundness" }, dirty: "polystarDirty" },
  ],
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

class SceneBuilder {
  private keyframesMap: Map<string, KeyframeRule> = new Map();
  private definitionsMap: Map<string, DefinitionRule> = new Map();
  // Static :root custom properties for build-time var() folding.
  private variablesMap: Map<string, Value> = new Map();
  // Authored `mask:` refs, resolved once the whole tree exists.
  private pendingMasks: PendingMask[] = [];
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

    resolveMasks(root, this.pendingMasks);
    this.pendingMasks = [];
    unTrapMaskedContent(root);

    // Machine pointer-trigger targets must be interactive for the hit-tester.
    root.machines = stylesheet.machines;
    markPointerTargets(root, stylesheet.machines);

    return root;
  }

  private buildNode(rule: Rule, sib: SiblingContext): SceneNode {
    rule = expandUse(rule, this.definitionsMap);

    const id = rule.selector.name;
    // Freeze random() now; keyframes freeze per-node in buildKeyframes.
    // NOTE: `&:hover > #c` blocks freeze/fold against the parent, not #c.
    rule = mapRuleDecls(rule, valueHasRandom, (d) =>
      freezeRandom(d.value, {
        documentSeed: this.documentSeed(),
        nodeId: id,
        property: d.property,
      }),
    );
    // Fold sibling-index()/sibling-count() the same way.
    rule = mapRuleDecls(rule, valueHasSiblingFn, (d) =>
      foldSiblingFns(d.value, sib),
    );

    const typeDecl = rule.declarations.find((d) => d.property === "type");
    const shapeType = (
      typeDecl ? getStringValue(typeDecl.value) : "group"
    ) as ShapeType;
    const node = createSceneNode(id, shapeType);
    // Materialize shapeData first so declaration order doesn't matter.
    node.shapeData = defaultShapeData(shapeType);

    if (rule.selector.type === "class") {
      node.className = id;
    }

    for (const decl of rule.declarations) this.applyDeclaration(node, decl);

    // circle/ellipse `x`/`y` box sugar → cx/cy, once r/rx/ry are final.
    resolveCircleEllipseBoxPosition(node);

    // `animation` + longhands compose per CSS (later wins per sub-property).
    node.animations.push(
      ...buildAnimations(
        rule.declarations,
        false,
        node.id,
        sib,
        this.keyframesMap,
        this.variablesMap,
        (r, id, s) => this.buildKeyframes(r, id, s),
      ),
    );

    node.transitions = resolveTransitions(rule.declarations, this.variablesMap);

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
            animations: buildAnimations(
              stateRule.declarations,
              true,
              node.id,
              sib,
              this.keyframesMap,
              this.variablesMap,
              (r, id, s) => this.buildKeyframes(r, id, s),
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
      const target = stateChildTarget(node, childRule.selector, `&:${state}`);
      if (!target) continue;
      const styles = this.buildStateStyles(childRule.declarations);
      if (state === "hover") target.hoverStyles = styles;
      else target.activeStyles = styles;
      if (!node.stateChildren.includes(target)) node.stateChildren.push(target);
    }

    // Machine state is global, so these merge into the child's own stateStyles.
    for (const { rule: childRule, machineState } of machineChildRules) {
      const target = stateChildTarget(
        node,
        childRule.selector,
        `&:state(${machineState.name})`,
      );
      if (!target) continue;
      target.stateStyles.push({
        machine: machineState.machine,
        name: machineState.name,
        styles: this.buildStateStyles(childRule.declarations),
        animations: buildAnimations(
          childRule.declarations,
          true,
          node.id,
          sib,
          this.keyframesMap,
          this.variablesMap,
          (r, id, s) => this.buildKeyframes(r, id, s),
        ),
      });
    }

    // Immutable base for the per-frame value-resolution pipeline.
    node.base = snapshotNode(node);

    return node;
  }

  private documentSeed(): number {
    this.docSeed ??= hashString(serialize(this.sheet!));
    return this.docSeed;
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
    const n = repeatCount(rule, this.variablesMap);
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

  // Shared by a node's own &:hover/&:active and state-child rules.
  private buildStateStyles(declarations: Declaration[]): StateStyles {
    const styles: StateStyles = {};

    for (const decl of declarations) {
      const { property, value } = decl;

      switch (property) {
        // Channels are exclusive; applyStateStyles clears the other.
        case "fill":
        case "stroke":
          applyPaint(styles, property, value, false);
          break;

        case "stroke-width":
          styles.strokeWidth = getNumericValue(value);
          break;

        case "opacity":
          styles.opacity = getNumericValue(value);
          break;

        case "transform": {
          const t: Partial<Transform> = {};
          extractTransform(value, (key, val) => {
            t[key] = val;
          });
          styles.transform = { ...styles.transform, ...t };
          break;
        }

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
          const value = resolveStaticVars(decl.value, this.variablesMap);
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
    const transitions = resolveTransitions(declarations, this.variablesMap);
    if (transitions.length > 0) styles.transitions = transitions;

    return styles;
  }

  private applyDeclaration(node: SceneNode, decl: Declaration): void {
    const { property } = decl;
    const value = STRUCTURAL_FOLD_PROPERTIES.has(property)
      ? resolveStaticVars(decl.value, this.variablesMap)
      : decl.value;

    // Live 0..1 scrub source, kept unresolved so var() stays overridable.
    if (property === "animation-timeline") {
      node.animationTimeline = decl.value;
      return;
    }

    if (hasVariableReference(value)) {
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
          extractTransform(value, (key, val) => {
            node.transform[key] = val;
          });
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
        node.transform.transformOrigin = parseTransformOrigin(value);
        break;

      // Text content, or image source (`content: url('…')`).
      case "content":
        if (node.shapeData.type === "text") {
          node.shapeData.content = getStringValue(value);
        } else if (node.shapeData.type === "image") {
          node.shapeData.src = imageSrc(value);
        }
        break;

      // xywh() skips the hasVariableReference check above; bind here.
      case "object-view-box":
        if (node.shapeData.type === "image") {
          if (isFunctionValue(value) && value.args.some(hasVariableReference)) {
            node.bindings.push({ property, value });
          } else {
            node.shapeData.viewBox = extractImageViewBox(value);
          }
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
      case "text-anchor": {
        const anchor = oneOf(value, TEXT_ANCHORS);
        if (node.shapeData.type === "text" && anchor)
          node.shapeData.anchor = anchor;
        break;
      }
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
      case "border-top-left-radius":
      case "border-top-right-radius":
      case "border-bottom-right-radius":
      case "border-bottom-left-radius":
        getPropHandler(property)?.apply(node, getNumericValue(value));
        break;

      case "d":
        if (node.shapeData.type === "path") {
          node.shapeData.commands = parsePath(getStringValue(value));
        }
        break;

      case "fill":
      case "stroke":
        applyPaint(node, property, value, true);
        break;

      case "clip-path":
        node.clipPath = parseClipPath(value);
        break;

      case "mask":
        parseMask(node, value, this.pendingMasks);
        break;

      // Filter function list; the whole list animates via the registry.
      case "filter":
        node.filter = parseFilter(value);
        break;

      // Comma list of shadows → drop-shadow FilterOps (spread/inset).
      case "box-shadow":
        node.boxShadow = parseBoxShadow(value);
        break;

      // Unknown keywords are ignored (stay 'normal').
      case "mix-blend-mode":
        node.mixBlendMode = oneOf(value, BLEND_MODES) ?? node.mixBlendMode;
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
        node.offsetRotate = parseOffsetRotate(value);
        break;

      case "stroke-width":
        node.strokeWidth = getNumericValue(value);
        break;

      case "stroke-linecap":
        node.strokeLineCap =
          oneOf(value, STROKE_LINE_CAPS) ?? node.strokeLineCap;
        break;

      case "stroke-linejoin":
        node.strokeLineJoin =
          oneOf(value, STROKE_LINE_JOINS) ?? node.strokeLineJoin;
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
        node.fillRule = oneOf(value, FILL_RULES) ?? node.fillRule;
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
        const curve = parseTimeRemap(value);
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

      default: {
        const spec = NUMERIC_SHAPE_PROPS.get(property);
        const field = spec?.fields[node.shapeData.type];
        if (!spec || !field) break;
        const sd = node.shapeData as unknown as Record<string, unknown>;
        sd[field] = getNumericValue(value);
        if (property === "cx" || property === "cy") {
          // Explicit centre beats circle/ellipse box sugar.
          if (sd.type === "circle" || sd.type === "ellipse")
            sd[property === "cx" ? "__cxSet" : "__cySet"] = true;
        }
        if (spec.dirty) node[spec.dirty] = true;
      }
    }
  }

  private buildKeyframes(
    rule: KeyframeRule,
    nodeId: string,
    sib: SiblingContext,
  ): KeyframeTrack[] {
    const frames = rule.blocks.flatMap((block) => {
      const properties = this.buildKeyframeProperties(block, nodeId, sib);
      const easing = block.easing
        ? timingFromValue(block.easing, this.variablesMap)
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
      const resolved = resolveStaticVars(withSibling, this.variablesMap);
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
          extractTransform(value, (key, val) => {
            props[key] = val;
          });
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
        const paint = parsePaint(value);
        if (paint?.type === "gradient") return paint.gradient ?? undefined;
        if (paint?.color != null) return paint.color;
        return undefined;
      }
      case "d":
        // Path morphing: parse the path string to commands once at build.
        return parsePath(getStringValue(value));
      case "clip-path": {
        // Only a path() clip morphs (circle/inset aren't command lists).
        const clip = parseClipPath(value);
        return clip && clip.type === "path" ? clip.commands : undefined;
      }
      case "filter":
        // Lerps per op when function sequences match (interpolateFilter).
        return parseFilter(value) ?? undefined;
      case "box-shadow":
        // Morphs when both lists share length/inset structure.
        return parseBoxShadow(value) ?? undefined;
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
}

export function buildSceneGraph(stylesheet: StyleSheet): SceneNode {
  const builder = new SceneBuilder();
  return builder.build(stylesheet);
}

// Match by class or id; an id also matches a namespaced `@define` tail.
function findDirectChild(
  parent: SceneNode,
  selector: Selector,
): SceneNode | undefined {
  if (selector.type === "class") {
    return parent.children.find((c) => c.className === selector.name);
  }
  return parent.children.find((c) => idMatches(c.id, selector.name));
}

// The direct child a `<state> > sel` rule targets; warns when there is none.
function stateChildTarget(
  parent: SceneNode,
  selector: Selector,
  state: string,
): SceneNode | undefined {
  const target = findDirectChild(parent, selector);
  if (!target)
    console.warn(
      `${state} > ${selector.type === "class" ? "." : "#"}${selector.name} in '${parent.id}' targets no direct child; ignored.`,
    );
  return target;
}

// circle/ellipse `x`/`y` box sugar → `cx = x + r`; explicit cx/cy wins.
function resolveCircleEllipseBoxPosition(node: SceneNode): void {
  const d = node.shapeData;
  if (d.type !== "circle" && d.type !== "ellipse") return;
  const rx = d.type === "circle" ? d.r : d.rx;
  const ry = d.type === "circle" ? d.r : d.ry;
  if (d.__boxX !== undefined && !d.__cxSet) d.cx = d.__boxX + rx;
  if (d.__boxY !== undefined && !d.__cySet) d.cy = d.__boxY + ry;
  delete d.__boxX;
  delete d.__boxY;
  delete d.__cxSet;
  delete d.__cySet;
}

// Fresh default geometry for a shape type; unknown types are groups.
function defaultShapeData(type: ShapeType): ShapeData {
  switch (type) {
    case "rect":
      return { type, x: 0, y: 0, width: 0, height: 0, rx: 0, ry: 0 };
    case "circle":
      return { type, cx: 0, cy: 0, r: 0 };
    case "ellipse":
      return { type, cx: 0, cy: 0, rx: 0, ry: 0 };
    case "path":
      return { type, commands: [] };
    case "star":
    case "polygon":
      return {
        type,
        sides: 5,
        outerRadius: 0,
        innerRadius: 0,
        rotation: 0,
        cx: 0,
        cy: 0,
        outerRoundness: 0,
        innerRoundness: 0,
      };
    case "text":
      return {
        type,
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
    case "image":
      return { type, x: 0, y: 0, width: 0, height: 0, src: "", viewBox: null };
    default:
      return { type: "group" };
  }
}
