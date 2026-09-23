import { expect, test } from "bun:test";
import { parse, type Value } from "@popkorn/parser";
import { foldSiblingFns } from "./sibling.js";
import { hasVariableReference, resolveStaticVars } from "./static-vars.js";

const val = (src: string): Value =>
  parse(`#b { r: ${src}; }`).rules[0].declarations[0].value;

const vars = new Map<string, Value>([["--lo", val("4px")]]);

test("resolveStaticVars: inlines static var()s inside random() operands", () => {
  const out = resolveStaticVars(val("random(var(--lo), 10px)"), vars);
  expect(out).toMatchObject({ type: "random", min: { value: 4, unit: "px" } });
});

test("resolveStaticVars: keeps round()'s strategy when folding leaves", () => {
  const out = resolveStaticVars(
    val("calc(round(up, var(--lo) * input(cursor.x), 5px))"),
    vars,
  );
  expect(JSON.stringify(out)).toContain('"strategy":"up"');
});

test("resolveStaticVars: returns the same object when nothing is static", () => {
  const v = val("var(--reactive) 2px");
  expect(resolveStaticVars(v, vars)).toBe(v);
});

test("hasVariableReference: random() operands are build-time, not bindings", () => {
  expect(hasVariableReference(val("random(var(--lo), 10px)"))).toBe(false);
  expect(hasVariableReference(val("calc(var(--lo) + 1px)"))).toBe(true);
});

test("foldSiblingFns: folds sibling-index() inside random() operands", () => {
  const out = foldSiblingFns(val("random(0px, calc(sibling-index() * 10px))"), {
    index: 3,
    count: 5,
  });
  expect(JSON.stringify(out)).not.toContain("sibling-index");
});
