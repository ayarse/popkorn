// animation/transition shorthand + longhand composition and easing parsing.

import type {
  Declaration,
  FunctionValue,
  KeyframeRule,
  Value,
} from "@popkorn/parser";
import {
  evalCalcStatic,
  getNumericValue,
  isCalcValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isStringValue,
} from "@popkorn/parser";
import type { SiblingContext } from "./sibling.js";
import { resolveStaticVars } from "./static-vars.js";
import type {
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  CompositeOperation,
  KeyframeTrack,
  LinearEasingPoint,
  StepPosition,
  TimeRemapStop,
  TimingFunction,
  TransitionSpec,
} from "./types.js";
import {
  ANIMATION_DIRECTIONS,
  ANIMATION_FILL_MODES,
  COMPOSITE_OPERATIONS,
  EASING_KEYWORDS,
  STEP_POSITIONS,
} from "./types.js";
import { oneOf } from "./value-parsers.js";

// `stateDefault`: unset fill-mode is `both`, so :state() one-shots hold.
export function buildAnimations(
  declarations: Declaration[],
  stateDefault: boolean,
  nodeId: string,
  sib: SiblingContext,
  keyframesMap: Map<string, KeyframeRule>,
  variables: Map<string, Value>,
  buildKeyframes: (
    rule: KeyframeRule,
    nodeId: string,
    sib: SiblingContext,
  ) => KeyframeTrack[],
): AnimationInstance[] {
  const slots = composeSlots(
    declarations,
    "animation",
    (g) => parseAnimationGroup(g, keyframesMap, variables),
    defaultAnimSlot,
    {
      "animation-name": (slot, v) => {
        if (isKeywordValue(v) || isStringValue(v)) slot.name = v.value;
      },
      "animation-duration": (slot, v) => {
        const ms = timeMs(v);
        if (ms !== null) {
          slot.duration = ms;
          slot.durationSet = true;
        }
      },
      "animation-delay": (slot, v) => {
        const ms = timeMs(v);
        if (ms !== null) slot.delay = ms;
      },
      "animation-timing-function": (slot, v) => {
        slot.timingFunction = timingFromValue(v, variables);
      },
      "animation-iteration-count": (slot, v) => {
        if (isKeywordValue(v) && v.value === "infinite")
          slot.iterationCount = Infinity;
        else if (isNumberValue(v)) slot.iterationCount = v.value;
      },
      "animation-direction": (slot, v) => {
        slot.direction = oneOf(v, ANIMATION_DIRECTIONS) ?? slot.direction;
      },
      "animation-fill-mode": (slot, v) => {
        const fillMode = oneOf(v, ANIMATION_FILL_MODES);
        if (fillMode) {
          slot.fillMode = fillMode;
          slot.fillModeSet = true;
        }
      },
      // Not part of the `animation` shorthand (which resets it to 'replace').
      "animation-composition": (slot, v) => {
        slot.composition = oneOf(v, COMPOSITE_OPERATIONS) ?? slot.composition;
      },
    },
  );

  if (!slots) return [];
  const out: AnimationInstance[] = [];
  for (const slot of slots) {
    if (slot.name && keyframesMap.has(slot.name)) {
      out.push({
        name: slot.name,
        duration: slot.duration,
        timingFunction: slot.timingFunction,
        iterationCount: slot.iterationCount,
        direction: slot.direction,
        delay: slot.delay,
        fillMode: stateDefault && !slot.fillModeSet ? "both" : slot.fillMode,
        composition: slot.composition,
        tracks: buildKeyframes(keyframesMap.get(slot.name)!, nodeId, sib),
      });
    }
  }
  return out;
}

// Compose `transition` + longhands like animations; drops zero durations.
export function resolveTransitions(
  declarations: Declaration[],
  variables: Map<string, Value>,
): TransitionSpec[] {
  const slots = composeSlots(
    declarations,
    "transition",
    (g) => parseTransitionGroup(g, variables),
    defaultTransSlot,
    {
      "transition-property": (slot, v) => {
        if (isKeywordValue(v)) slot.property = v.value;
      },
      "transition-duration": (slot, v) => {
        const ms = timeMs(v);
        if (ms !== null) slot.duration = ms;
      },
      "transition-delay": (slot, v) => {
        const ms = timeMs(v);
        if (ms !== null) slot.delay = ms;
      },
      "transition-timing-function": (slot, v) => {
        slot.easing = timingFromValue(v, variables);
      },
    },
  );

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
function parseTransitionGroup(
  values: Value[],
  variables: Map<string, Value>,
): TransSlot {
  const slot = defaultTransSlot();
  let durationSet = false;
  for (const raw of values) {
    const v = resolveStaticVars(raw, variables);
    const ms = timeMs(v);
    if (ms !== null) {
      if (!durationSet) {
        slot.duration = ms;
        durationSet = true;
      } else slot.delay = ms;
    } else if (isFunctionValue(v) && isTimingFunctionName(v.name)) {
      slot.easing = timingFromFunction(v);
    } else if (isKeywordValue(v)) {
      const easing = oneOf(v, EASING_KEYWORDS);
      if (easing) slot.easing = easing;
      else slot.property = v.value; // all/fill/stroke/stroke-width/opacity/transform
    }
  }
  return slot;
}

/** Parse one `animation` shorthand group (space-separated) into a slot. */
function parseAnimationGroup(
  values: Value[],
  keyframesMap: Map<string, KeyframeRule>,
  variables: Map<string, Value>,
): AnimSlot {
  const slot = defaultAnimSlot();
  for (const raw of values) {
    const v = resolveStaticVars(raw, variables);
    if (isKeywordValue(v)) {
      const kw = v.value;
      const easing = oneOf(v, EASING_KEYWORDS);
      const direction = oneOf(v, ANIMATION_DIRECTIONS);
      const fillMode = oneOf(v, ANIMATION_FILL_MODES);
      if (keyframesMap.has(kw)) slot.name = kw;
      else if (easing) slot.timingFunction = easing;
      else if (kw === "infinite") slot.iterationCount = Infinity;
      else if (direction) slot.direction = direction;
      else if (fillMode) {
        slot.fillMode = fillMode;
        slot.fillModeSet = true;
      }
    } else if (isFunctionValue(v) && isTimingFunctionName(v.name)) {
      slot.timingFunction = timingFromFunction(v);
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

function isTimingFunctionName(name: string): boolean {
  return name === "cubic-bezier" || name === "steps" || name === "linear";
}

/** Resolve a timing-function FunctionValue (cubic-bezier(), steps(), linear()). */
function timingFromFunction(v: FunctionValue): TimingFunction {
  if (v.name === "cubic-bezier") return parseCubicBezierFunction(v);
  if (v.name === "steps") return parseStepsFunction(v);
  if (v.name === "linear") return parseLinearFunction(v);
  return "ease";
}

// `linear()`: each number opens a point, following %s are its inputs.
function parseLinearFunction(func: FunctionValue): TimingFunction {
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
function parseStepsFunction(func: FunctionValue): TimingFunction {
  let count = 1;
  let position: StepPosition = "jump-end";
  for (const arg of func.args) {
    if (isNumberValue(arg)) count = Math.max(1, Math.round(arg.value));
    else if (isKeywordValue(arg)) {
      const p = arg.value;
      if (p === "start") position = "jump-start";
      else if (p === "end") position = "jump-end";
      else position = oneOf(arg, STEP_POSITIONS) ?? position;
    }
  }
  return { type: "steps", count, position };
}

// The one easing path: shorthand, longhand and per-keyframe easing.
export function timingFromValue(
  rawV: Value,
  variables: Map<string, Value>,
): TimingFunction {
  // A static var() easing resolves to its :root function first.
  const v = resolveStaticVars(rawV, variables);
  if (isFunctionValue(v) && isTimingFunctionName(v.name))
    return timingFromFunction(v);
  return oneOf(v, EASING_KEYWORDS) ?? "ease";
}

// `time-remap` list of `<in> <out> [easing]` stops, sorted; null if none.
export function parseTimeRemap(value: Value): TimeRemapStop[] | null {
  const items =
    isListValue(value) && value.separator === "comma" ? value.values : [value];
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
        easing = parseCubicBezierFunction(p);
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

function parseCubicBezierFunction(func: FunctionValue): TimingFunction {
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

// CSS list composition: the shorthand resets the slots, longhands index positionally.
function composeSlots<S>(
  declarations: Declaration[],
  shorthand: string,
  parseGroup: (values: Value[]) => S,
  makeSlot: () => S,
  longhands: Record<string, (slot: S, v: Value) => void>,
): S[] | null {
  let slots: S[] | null = null;
  for (const decl of declarations) {
    if (decl.property === shorthand) {
      slots = commaValues(decl.value).map((g) =>
        parseGroup(isListValue(g) ? g.values : [g]),
      );
      continue;
    }
    // The prefix check keeps Object.prototype names out of the lookup.
    const set = decl.property.startsWith(`${shorthand}-`)
      ? longhands[decl.property]
      : undefined;
    if (!set) continue;
    // Grow so a longhand before any shorthand still defines slots.
    const vals = commaValues(decl.value);
    slots ??= [];
    while (slots.length < vals.length) slots.push(makeSlot());
    for (let i = 0; i < slots.length; i++) set(slots[i], vals[i % vals.length]);
  }
  return slots;
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

// Time value (`s`/`ms`) to milliseconds, or null when it isn't a time.
// NOTE: static calc() only; reactive timing needs a live scheduler.
export function timeMs(value: Value): number | null {
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
