// Render-preserving, AST-driven rename of ids, classes, @keyframes, @define and --vars to short names;
// identical @keyframes merge; path data is compacted and single-use path vars are inlined.
// Host-visible names (input() paths, @machine/state/emit/event names) are preserved.

import type {
  ColorValue,
  Declaration,
  DefinitionRule,
  KeyframeRule,
  KeywordValue,
  MachineGuard,
  MachineRule,
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
import { mapValue, someValue } from "./ast.js";
import {
  isKeyframeNameToken,
  isReservedAnimationKeyword,
} from "./diagnostics.js";
import { compactPath } from "./path-codec.js";

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
  return [3, 4, 6, 8].includes(s.length) && /^[0-9a-f]+$/i.test(s);
}

// One rename namespace; `prefix` keeps custom properties' `--` (`--brand` → `--a`).
class Renamer {
  private map = new Map<string, string>();
  private readonly gen = makeNameGen();
  constructor(private readonly prefix = "") {}
  add(name: string): void {
    if (!this.map.has(name)) this.map.set(name, this.prefix + this.gen());
  }
  // Point `name` at `target`'s crushed name (target must already be added).
  alias(name: string, target: string): void {
    this.map.set(name, this.get(target));
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
  sheet = compactPaths(sheet);
  const maps: Maps = {
    ids: new Renamer(),
    classes: new Renamer(),
    keyframes: new Renamer(),
    defines: new Renamer(),
    vars: new Renamer("--"),
  };

  // Var uses are registered too: they may name a var only the host declares.
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
  const keyframes = dedupeKeyframes(sheet.keyframes, maps);

  return {
    ...sheet,
    variables: sheet.variables.map((v) => renameVarDef(v, maps)),
    keyframes: keyframes.map((kf) => renameKeyframes(kf, maps)),
    definitions: sheet.definitions.map((d) => renameDefine(d, maps)),
    machines: sheet.machines.map((m) => renameMachine(m, maps)),
    rules: sheet.rules.map((r) => renameRule(r, maps)),
  };
}

// Merges @keyframes whose effective (last-defined) bodies match after renaming; registers keyframe names.
function dedupeKeyframes(kfs: KeyframeRule[], maps: Maps): KeyframeRule[] {
  const effective = new Map<string, KeyframeRule>();
  for (const kf of kfs) effective.set(kf.name, kf);
  // Keyed with keyframe names un-renamed: equal tokens stay equal under any rename.
  const keyed: Maps = { ...maps, keyframes: new Renamer() };
  const survivorByBody = new Map<string, string>();
  const aliasOf = new Map<string, string>();
  for (const [name, kf] of effective) {
    const body = keyframesBodyKey(renameKeyframes(kf, keyed));
    const survivor = survivorByBody.get(body);
    if (survivor === undefined) survivorByBody.set(body, name);
    else aliasOf.set(name, survivor);
  }
  const kept = kfs.filter((kf) => !aliasOf.has(kf.name));
  for (const kf of kept) maps.keyframes.add(kf.name);
  for (const [name, survivor] of aliasOf) maps.keyframes.alias(name, survivor);
  return kept;
}

// Names dedupeKeyframes will alias away: equal bodies stay equal under any deterministic rewrite.
function mergedKeyframeNames(kfs: KeyframeRule[]): Set<string> {
  const effective = new Map<string, KeyframeRule>();
  for (const kf of kfs) effective.set(kf.name, kf);
  const seen = new Set<string>();
  const merged = new Set<string>();
  for (const [name, kf] of effective) {
    const body = keyframesBodyKey(kf);
    if (seen.has(body)) merged.add(name);
    else seen.add(body);
  }
  return merged;
}

// Structural identity of a keyframes body: blocks sans name and source spans.
function keyframesBodyKey(kf: KeyframeRule): string {
  return JSON.stringify(kf.blocks, (k, v) =>
    k === "span" || k === "valueSpan" || k === "selectorSpan" ? undefined : v,
  );
}

// --- path data: compact re-encode + single-use path var inlining ----------

type ValueMapper = (property: string, value: Value) => Value;

// Rewrites every declared value in the sheet, :root vars and keyframe easings included.
function mapSheetValues(sheet: StyleSheet, f: ValueMapper): StyleSheet {
  const decls = (ds: Declaration[]) =>
    ds.map((d) => ({ ...d, value: f(d.property, d.value) }));
  const body = <T extends { declarations: Declaration[]; children: Rule[] }>(
    b: T & { states?: StateRule[] },
  ): T => ({
    ...b,
    declarations: decls(b.declarations),
    children: b.children.map(body),
    ...(b.states && { states: b.states.map(body) }),
  });
  return {
    ...sheet,
    variables: sheet.variables.map((v) => ({
      ...v,
      value: f(v.name, v.value),
    })),
    keyframes: sheet.keyframes.map((kf) => ({
      ...kf,
      blocks: kf.blocks.map((b) => ({
        ...b,
        declarations: decls(b.declarations),
        easing: b.easing && f("animation-timing-function", b.easing),
      })),
    })),
    definitions: sheet.definitions.map(body),
    rules: sheet.rules.map(body),
  };
}

interface VarUses {
  path: number; // as a `d` value or a path() argument
  other: number;
  aliases: string[]; // `--alias: var(--this)` definitions
  defs: number;
  rootDefs: number;
}

// Compacts path strings (`d`, path(), vars used only as paths) and inlines single-use :root path vars.
function compactPaths(sheet: StyleSheet): StyleSheet {
  const uses = new Map<string, VarUses>();
  const at = (name: string): VarUses => {
    let u = uses.get(name);
    if (!u) {
      u = { path: 0, other: 0, aliases: [], defs: 0, rootDefs: 0 };
      uses.set(name, u);
    }
    return u;
  };
  // ctx: "d" = path position, "--x" = aliased by --x, "" = anything else.
  const scan = (v: Value, ctx: string): void => {
    if (v.type === "variable") {
      const u = at(v.name);
      if (ctx === "d") u.path++;
      else if (ctx) u.aliases.push(ctx);
      else u.other++;
      if (v.fallback) scan(v.fallback, ctx);
    } else if (v.type === "function") {
      const path = v.name === "path";
      for (let i = 0; i < v.args.length; i++)
        scan(v.args[i], path && i === 0 ? "d" : "");
    } else if (v.type === "list") for (const x of v.values) scan(x, "");
    else if (v.type === "random" || v.type === "calc")
      someValue(v, (x) => {
        if (x.type === "variable") at(x.name).other++;
        return false;
      });
  };
  const ctxOf = (property: string) =>
    property === "d" ? "d" : property.startsWith("--") ? property : "";
  for (const v of sheet.variables) at(v.name).rootDefs++;
  // Refs inside @keyframes that dedupe will merge away don't count.
  const merged = mergedKeyframeNames(sheet.keyframes);
  const counted = {
    ...sheet,
    keyframes: sheet.keyframes.filter((kf) => !merged.has(kf.name)),
  };
  mapSheetValues(counted, (property, value) => {
    if (property.startsWith("--")) at(property).defs++;
    scan(value, ctxOf(property));
    return value;
  });
  for (const m of sheet.machines)
    for (const s of m.states)
      for (const t of s.transitions)
        for (const g of t.guards)
          if (g.left.kind === "var") at(g.left.name).other++;

  // Vars whose every use is a path position, directly or through other path vars.
  const pathVars = new Set<string>();
  for (const [name, u] of uses)
    if (u.other === 0 && u.path + u.aliases.length > 0) pathVars.add(name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of pathVars)
      if (at(name).aliases.some((a) => !pathVars.has(a))) {
        pathVars.delete(name);
        changed = true;
      }
  }

  const compact = (s: StringValue): StringValue => ({
    ...s,
    value: compactPath(s.value),
  });
  const inline = new Map<string, StringValue>();
  for (const v of sheet.variables) {
    const u = at(v.name);
    if (
      pathVars.has(v.name) &&
      v.value.type === "string" &&
      u.rootDefs === 1 &&
      u.defs === 1 &&
      u.path + u.aliases.length === 1
    )
      inline.set(v.name, compact(v.value));
  }

  const out = mapSheetValues(sheet, (property, value) => {
    if ((property === "d" || pathVars.has(property)) && value.type === "string")
      return compact(value);
    return mapValue(value, (x) => {
      if (x.type === "variable") return inline.get(x.name);
      if (
        x.type === "function" &&
        x.name === "path" &&
        x.args[0]?.type === "string"
      )
        return { ...x, args: [compact(x.args[0]), ...x.args.slice(1)] };
      return undefined;
    });
  });
  return {
    ...out,
    variables: out.variables.filter((v) => !inline.has(v.name)),
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
  someValue(v, (x) => {
    if (x.type === "variable") maps.vars.add(x.name);
    return false;
  });
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
    ...renameBody(rule, maps),
    selector: renameSelector(rule.selector, maps),
  };
}

function renameDefine(def: DefinitionRule, maps: Maps): DefinitionRule {
  return { ...renameBody(def, maps), name: maps.defines.get(def.name) };
}

// Rule, @define and state-block bodies; state blocks carry no `states`.
function renameBody<
  T extends {
    declarations: Declaration[];
    children: Rule[];
    states?: StateRule[];
  },
>(b: T, maps: Maps): T {
  return {
    ...b,
    declarations: b.declarations.map((d) => renameDecl(d, maps)),
    children: b.children.map((c) => renameRule(c, maps)),
    ...(b.states && { states: b.states.map((s) => renameBody(s, maps)) }),
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
// A random() `ident` is a sharing key, not a declared --var: left as-is.
function renameValue(v: Value, maps: Maps): Value {
  return mapValue(v, (x) => {
    if (x.type === "variable")
      return {
        ...x,
        name: maps.vars.get(x.name),
        fallback: x.fallback && renameValue(x.fallback, maps),
      };
    if (x.type === "keyword" || x.type === "color") return renameIdRef(x, maps);
    return undefined;
  });
}

// A known `#id` → its crushed name; real colors and keywords unchanged.
function renameIdRef(v: KeywordValue | ColorValue, maps: Maps): Value {
  const raw = v.value;
  if (raw.startsWith("#") && maps.ids.has(raw.slice(1)))
    return { ...v, value: "#" + maps.ids.get(raw.slice(1)) };
  return v;
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
  if (isKeyframeNameToken(v.value) && maps.keyframes.has(v.value))
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
    states: m.states.map((s) => ({
      ...s,
      transitions: s.transitions.map((t) => renameTransition(t, maps)),
    })),
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
