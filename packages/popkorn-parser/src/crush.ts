// Render-preserving, AST-driven rename of ids, classes, @keyframes, @define and --vars to short names.
// Host-visible names (input() paths, @machine/state/emit/event names) are preserved.

import type {
  CalcExpr,
  ColorValue,
  Declaration,
  DefinitionRule,
  KeyframeRule,
  KeywordValue,
  MachineGuard,
  MachineRule,
  MachineState,
  MachineTransition,
  MachineTrigger,
  Rule,
  Selector,
  StateRule,
  StringValue,
  StyleSheet,
  Value,
  VariableDefinition,
} from "./ast.js";
import { isReservedAnimationKeyword } from "./diagnostics.js";

// a, b, … aa, …; skips animation keywords and hex-color-shaped names, which would re-parse differently.
function makeNameGen(): () => string {
  let i = 0;
  const enc = (n: number): string => {
    let s = "";
    n++; // 1-based, so the width rolls over cleanly (a..z, aa..)
    while (n > 0) {
      n--;
      s = String.fromCharCode(97 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  };
  return () => {
    for (;;) {
      const name = enc(i++);
      if (isReservedAnimationKeyword(name) || isHexColorShaped(name)) continue;
      return name;
    }
  };
}

// A 3/4/6/8-length all-hex-digit token lexes as a `#`-color, not a keyword.
function isHexColorShaped(s: string): boolean {
  return (
    (s.length === 3 || s.length === 4 || s.length === 6 || s.length === 8) &&
    /^[0-9a-f]+$/i.test(s)
  );
}

// One rename namespace; `prefix` keeps custom properties' `--` (`--brand` → `--a`).
class Renamer {
  private map = new Map<string, string>();
  constructor(
    private readonly gen = makeNameGen(),
    private readonly prefix = "",
  ) {}
  add(name: string): void {
    if (!this.map.has(name)) this.map.set(name, this.prefix + this.gen());
  }
  get(name: string): string {
    return this.map.get(name) ?? name;
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
}

interface Maps {
  ids: Renamer;
  classes: Renamer;
  keyframes: Renamer;
  defines: Renamer;
  vars: Renamer;
}

/** Rename every identifier in `sheet` to a short name; returns a new sheet. */
export function crush(sheet: StyleSheet): StyleSheet {
  const maps: Maps = {
    ids: new Renamer(),
    classes: new Renamer(),
    keyframes: new Renamer(),
    defines: new Renamer(),
    vars: new Renamer(makeNameGen(), "--"),
  };

  // Var uses are registered too: they may name a var only the host declares.
  for (const kf of sheet.keyframes) maps.keyframes.add(kf.name);
  for (const def of sheet.definitions) maps.defines.add(def.name);
  for (const v of sheet.variables) maps.vars.add(v.name);
  for (const v of sheet.variables) collectVarUses(v.value, maps);
  for (const kf of sheet.keyframes)
    for (const b of kf.blocks) {
      collectDeclSites(b.declarations, maps);
      if (b.easing) collectVarUses(b.easing, maps);
    }
  for (const def of sheet.definitions) collectRuleSites(def, maps);
  for (const rule of sheet.rules) collectRuleSites(rule, maps);
  for (const m of sheet.machines) collectMachineSites(m, maps);

  return {
    ...sheet,
    variables: sheet.variables.map((v) => renameVarDef(v, maps)),
    keyframes: sheet.keyframes.map((kf) => renameKeyframes(kf, maps)),
    definitions: sheet.definitions.map((d) => renameDefine(d, maps)),
    machines: sheet.machines.map((m) => renameMachine(m, maps)),
    rules: sheet.rules.map((r) => renameRule(r, maps)),
  };
}

// --- pass 1: collect ------------------------------------------------------

function collectSelector(sel: Selector, maps: Maps): void {
  if (sel.type === "id") maps.ids.add(sel.name);
  else if (sel.type === "class") maps.classes.add(sel.name);
}

function collectRuleSites(rule: Rule | DefinitionRule, maps: Maps): void {
  if ("selector" in rule) collectSelector(rule.selector, maps);
  collectDeclSites(rule.declarations, maps);
  for (const ch of rule.children) collectRuleSites(ch, maps);
  for (const st of rule.states) collectStateSites(st, maps);
}

function collectStateSites(st: StateRule, maps: Maps): void {
  collectDeclSites(st.declarations, maps);
  for (const ch of st.children) collectRuleSites(ch, maps);
}

function collectDeclSites(decls: Declaration[], maps: Maps): void {
  for (const d of decls) {
    if (d.property.startsWith("--")) maps.vars.add(d.property);
    collectVarUses(d.value, maps);
  }
}

// Registers var() names so uses of host-declared vars still crush consistently.
function collectVarUses(v: Value, maps: Maps): void {
  switch (v.type) {
    case "variable":
      maps.vars.add(v.name);
      if (v.fallback) collectVarUses(v.fallback, maps);
      break;
    case "function":
      for (const a of v.args) collectVarUses(a, maps);
      break;
    case "list":
      for (const a of v.values) collectVarUses(a, maps);
      break;
    case "calc":
      collectCalcVarUses(v.expr, maps);
      break;
  }
}

function collectCalcVarUses(expr: CalcExpr, maps: Maps): void {
  if (expr.type === "calc-operand") collectVarUses(expr.value, maps);
  else if (expr.type === "calc-function")
    for (const a of expr.args) collectCalcVarUses(a, maps);
  else {
    collectCalcVarUses(expr.left, maps);
    collectCalcVarUses(expr.right, maps);
  }
}

function collectMachineSites(m: MachineRule, maps: Maps): void {
  for (const s of m.states)
    for (const t of s.transitions)
      for (const g of t.guards)
        if (g.left.kind === "var") maps.vars.add(g.left.name);
}

// --- pass 2: rewrite ------------------------------------------------------

function renameSelector(sel: Selector, maps: Maps): Selector {
  if (sel.type === "id") return { ...sel, name: maps.ids.get(sel.name) };
  if (sel.type === "class") return { ...sel, name: maps.classes.get(sel.name) };
  return sel;
}

function renameRule(rule: Rule, maps: Maps): Rule {
  return {
    ...rule,
    selector: renameSelector(rule.selector, maps),
    declarations: rule.declarations.map((d) => renameDecl(d, maps)),
    children: rule.children.map((c) => renameRule(c, maps)),
    states: rule.states.map((s) => renameState(s, maps)),
  };
}

function renameDefine(def: DefinitionRule, maps: Maps): DefinitionRule {
  return {
    ...def,
    name: maps.defines.get(def.name),
    declarations: def.declarations.map((d) => renameDecl(d, maps)),
    children: def.children.map((c) => renameRule(c, maps)),
    states: def.states.map((s) => renameState(s, maps)),
  };
}

function renameState(st: StateRule, maps: Maps): StateRule {
  return {
    ...st,
    declarations: st.declarations.map((d) => renameDecl(d, maps)),
    children: st.children.map((c) => renameRule(c, maps)),
  };
}

function renameVarDef(v: VariableDefinition, maps: Maps): VariableDefinition {
  return { name: maps.vars.get(v.name), value: renameValue(v.value, maps) };
}

function renameKeyframes(kf: KeyframeRule, maps: Maps): KeyframeRule {
  return {
    ...kf,
    name: maps.keyframes.get(kf.name),
    blocks: kf.blocks.map((b) => ({
      ...b,
      declarations: b.declarations.map((d) => renameDecl(d, maps)),
      easing: b.easing ? renameValue(b.easing, maps) : undefined,
    })),
  };
}

function renameDecl(d: Declaration, maps: Maps): Declaration {
  const property = d.property.startsWith("--")
    ? maps.vars.get(d.property)
    : d.property;

  // Context-sensitive references: which token is a name depends on the property.
  if (d.property === "animation" || d.property === "animation-name")
    return { ...d, property, value: renameAnimationValue(d.value, maps) };
  if (d.property === "use")
    return { ...d, property, value: renameKeyword(d.value, maps.defines) };

  return { ...d, property, value: renameValue(d.value, maps) };
}

// Rewrites var() names and `#id` refs, incl. hex-shaped ids the parser lexed as colors.
function renameValue(v: Value, maps: Maps): Value {
  switch (v.type) {
    case "variable":
      return {
        ...v,
        name: maps.vars.get(v.name),
        fallback: v.fallback ? renameValue(v.fallback, maps) : undefined,
      };
    case "keyword":
      return renameIdRef(v, maps);
    case "color":
      return renameIdRef(v, maps);
    case "function":
      return { ...v, args: v.args.map((a) => renameValue(a, maps)) };
    case "list":
      return { ...v, values: v.values.map((a) => renameValue(a, maps)) };
    case "calc":
      return { ...v, expr: renameCalc(v.expr, maps) };
    case "random":
      // `ident` is a random() sharing key, not a declared --var: left as-is.
      return {
        ...v,
        min: renameValue(v.min, maps),
        max: renameValue(v.max, maps),
        step: v.step ? renameValue(v.step, maps) : undefined,
      };
    default:
      return v;
  }
}

// A known `#id` → its crushed name; real colors and keywords unchanged.
function renameIdRef(v: KeywordValue | ColorValue, maps: Maps): Value {
  const raw = v.value;
  if (raw.startsWith("#") && maps.ids.has(raw.slice(1)))
    return { ...v, value: "#" + maps.ids.get(raw.slice(1)) };
  return v;
}

function renameCalc(expr: CalcExpr, maps: Maps): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: renameValue(expr.value, maps) };
  if (expr.type === "calc-function")
    return { ...expr, args: expr.args.map((a) => renameCalc(a, maps)) };
  return {
    ...expr,
    left: renameCalc(expr.left, maps),
    right: renameCalc(expr.right, maps),
  };
}

// Rewrites only tokens naming a known @keyframes.
function renameAnimationValue(v: Value, maps: Maps): Value {
  if (v.type === "keyword" || v.type === "string")
    return renameKeyframeToken(v, maps);
  if (v.type === "list")
    return { ...v, values: v.values.map((a) => renameAnimationValue(a, maps)) };
  return renameValue(v, maps);
}

function renameKeyframeToken(v: KeywordValue | StringValue, maps: Maps): Value {
  if (
    !isReservedAnimationKeyword(v.value) &&
    !v.value.startsWith("#") &&
    !v.value.includes(".") &&
    maps.keyframes.has(v.value)
  )
    return { ...v, value: maps.keyframes.get(v.value) };
  return v;
}

function renameKeyword(v: Value, r: Renamer): Value {
  if ((v.type === "keyword" || v.type === "string") && r.has(v.value))
    return { ...v, value: r.get(v.value) };
  return v;
}

// --- machines: rewrite only var-guard and id-target refs ------------------

function renameMachine(m: MachineRule, maps: Maps): MachineRule {
  return {
    ...m,
    states: m.states.map((s) => renameMachineState(s, maps)),
  };
}

function renameMachineState(s: MachineState, maps: Maps): MachineState {
  return {
    ...s,
    transitions: s.transitions.map((t) => renameTransition(t, maps)),
  };
}

function renameTransition(t: MachineTransition, maps: Maps): MachineTransition {
  // t.mix.easing is a plain string, never a var() reference.
  return {
    ...t,
    trigger: t.trigger ? renameTrigger(t.trigger, maps) : t.trigger,
    guards: t.guards.map((g) => renameGuard(g, maps)),
  };
}

function renameTrigger(tr: MachineTrigger, maps: Maps): MachineTrigger {
  if (tr.kind === "pointer" && tr.target.type === "id")
    return {
      ...tr,
      target: { ...tr.target, name: maps.ids.get(tr.target.name) },
    };
  return tr;
}

function renameGuard(g: MachineGuard, maps: Maps): MachineGuard {
  if (g.left.kind === "var")
    return { ...g, left: { ...g.left, name: maps.vars.get(g.left.name) } };
  return g;
}
