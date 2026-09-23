// Rule-level expansion: `use:` symbols, `repeat:` copies, declaration rewrites.

import type {
  Declaration,
  DefinitionRule,
  Rule,
  StateRule,
  Value,
} from "@popkorn/parser";
import { getStringValue, isNumberValue } from "@popkorn/parser";
import { hasVariableReference, resolveStaticVars } from "./static-vars.js";

// `repeat:` copy cap — a typo'd count must not OOM. Above this is a diagnostic.
const REPEAT_CAP = 10000;

// An id, or a namespaced `@define` instance id ending in it.
export const idMatches = (nodeId: string, name: string): boolean =>
  nodeId === name || nodeId.endsWith(`.${name}`);

// The `repeat:` count or null; static only (the tree is fixed over time).
export function repeatCount(
  rule: Rule,
  variables: Map<string, Value>,
): number | null {
  const decl = rule.declarations.find((d) => d.property === "repeat");
  if (!decl) return null;
  const id = rule.selector.name;
  const resolved = resolveStaticVars(decl.value, variables);
  if (hasVariableReference(resolved)) {
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
export function expandUse(
  rule: Rule,
  definitions: Map<string, DefinitionRule>,
  inProgress: Set<string> = new Set(),
): Rule {
  const useDecl = rule.declarations.find((d) => d.property === "use");
  if (!useDecl) return rule;

  const name = getStringValue(useDecl.value);
  const def = definitions.get(name);
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
  const resolvedDef = expandUse(
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
    definitions,
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

// A rule minus its `repeat:` declaration.
export function stripRepeatDecl(rule: Rule): Rule {
  return {
    ...rule,
    declarations: rule.declarations.filter((d) => d.property !== "repeat"),
  };
}

// Suffix every id in a rule tree, state-block children included.
export function suffixRuleIds(rule: Rule, suffix: string): Rule {
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
export function isPureOverride(rule: Rule): boolean {
  return (
    rule.children.length === 0 &&
    !rule.declarations.some(
      (d) => d.property === "type" || d.property === "use",
    )
  );
}

// `repeat:` is instance context; a @define body may not carry it anywhere.
export function assertNoRepeatInDefinition(def: DefinitionRule): void {
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

// Rewrite matching values in a rule's own + state-block declarations; same rule if none match.
export function mapRuleDecls(
  rule: Rule,
  test: (v: Value) => boolean,
  map: (d: Declaration) => Value,
): Rule {
  let hit = false;
  const mapDecls = (decls: Declaration[]): Declaration[] =>
    decls.map((d) => {
      if (!test(d.value)) return d;
      hit = true;
      return { ...d, value: map(d) };
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
  return hit ? { ...rule, declarations, states } : rule;
}

// Merge state blocks: a use-site block replaces the definition's for the same pseudo.
export function mergeStates(
  defStates: StateRule[],
  useStates: StateRule[],
): StateRule[] {
  const byPseudo = new Map<string, StateRule>();
  for (const s of defStates) byPseudo.set(s.state, s);
  for (const s of useStates) byPseudo.set(s.state, s);
  return [...byPseudo.values()];
}
