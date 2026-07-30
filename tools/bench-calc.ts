/**
 * Reactive-calc throughput bench: times the per-frame value-resolution path
 * (VariableResolver.resolveNumeric over every node binding) in isolation — no
 * canvas, no rAF, so it is stable enough to compare VM changes against.
 *
 * Usage: bun tools/bench-calc.ts [path/to/scene.css]
 */
import { readFileSync } from "node:fs";
import { parse } from "../packages/popkorn-parser/src/index";
import { VariableResolver } from "../packages/popkorn-player/src/runtime/variables";
import { buildSceneGraph } from "../packages/popkorn-player/src/scene/builder";
import type { SceneNode } from "../packages/popkorn-player/src/scene/types";

const file = process.argv[2] ?? "examples/popkorn/22-p5-particle-field.css";
const ast = parse(readFileSync(file, "utf8"));
const root = buildSceneGraph(ast);

const nodes: SceneNode[] = [];
(function walk(n: SceneNode) {
  nodes.push(n);
  for (const c of n.children) walk(c);
})(root);

const resolver = new VariableResolver();
resolver.setVariables(ast.variables ?? []);

const values = nodes.flatMap((n) => n.bindings.map((b) => b.value));
if (values.length === 0) throw new Error(`${file}: no reactive bindings`);
// Same batching the render loop plans at setScene, so the bench times the
// shipping path (structurally-identical clone expressions run multi-lane).
resolver.planCalcBatches(values);

const pass = () => {
  resolver.beginFrame();
  let sink = 0;
  for (const v of values) sink += resolver.resolveNumeric(v);
  return sink;
};

let sink = 0;
for (let i = 0; i < 50; i++) sink += pass(); // warm the JIT

const R = 20;
let best = Infinity;
for (let r = 0; r < 15; r++) {
  const t0 = performance.now();
  for (let k = 0; k < R; k++) sink += pass();
  best = Math.min(best, performance.now() - t0);
}

const perFrameMs = best / R;
console.log(
  `${file}\n  nodes ${nodes.length - 1}, reactive values ${values.length}` +
    `\n  ${perFrameMs.toFixed(2)} ms/frame  ` +
    `${((perFrameMs * 1e6) / values.length).toFixed(0)} ns/value` +
    `  (sink ${sink.toFixed(0)})`,
);
