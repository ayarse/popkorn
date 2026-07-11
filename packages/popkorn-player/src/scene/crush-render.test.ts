import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, serialize } from "@popkorn/parser";
import type { Renderer } from "../renderer/interface";
import type {
  Color,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
  TrimDescriptor,
} from "../renderer/types";
import { RenderLoop } from "../runtime/loop";
import type {
  FillRule,
  MaskMode,
  StrokeLineCap,
  TextAnchor,
} from "../scene/types";
import { buildSceneGraph } from "./builder";

// A renderer that records every primitive call (name + args) as a flat trace.
// The trace carries geometry/paint but NO identifier strings, so it is exactly
// the render-identity signal crush must preserve: same trace ⇒ same frame.
function tracer(): Renderer & { trace: string[] } {
  const trace: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      trace.push(name + "(" + JSON.stringify(args) + ")");
    };
  return {
    trace,
    clear: rec("clear"),
    beginFrame: rec("beginFrame"),
    endFrame: rec("endFrame"),
    drawRect: rec("drawRect"),
    drawCircle: rec("drawCircle"),
    drawEllipse: rec("drawEllipse"),
    drawPath: rec("drawPath"),
    drawText: rec("drawText"),
    drawImage: rec("drawImage"),
    clip: rec("clip"),
    compositeMask(_m: MaskMode, drawContent: () => void, drawMask: () => void) {
      trace.push("compositeMask:begin");
      drawContent();
      drawMask();
      trace.push("compositeMask:end");
    },
    setFill: rec("setFill"),
    setFillGradient: rec("setFillGradient"),
    setStroke: rec("setStroke"),
    setStrokeGradient: rec("setStrokeGradient"),
    setStrokeLineCap: rec("setStrokeLineCap"),
    setStrokeLineJoin: rec("setStrokeLineJoin"),
    setStrokeMiterLimit: rec("setStrokeMiterLimit"),
    setTrim: rec("setTrim"),
    setDash: rec("setDash"),
    setFillRule: rec("setFillRule"),
    setPaintOrder: rec("setPaintOrder"),
    setOpacity: rec("setOpacity"),
    save: rec("save"),
    restore: rec("restore"),
    translate: rec("translate"),
    rotate: rec("rotate"),
    scale: rec("scale"),
    transform: rec("transform"),
    setTransform: rec("setTransform"),
    getWidth: () => 300,
    getHeight: () => 300,
  } as unknown as Renderer & { trace: string[] };
}

// Render `src` at a handful of instants and concatenate the traces.
function renderTrace(src: string): string {
  const root = buildSceneGraph(parse(src));
  const r = tracer();
  const loop = new RenderLoop(r);
  loop.setScene(root);
  loop.pause();
  for (const t of [0, 250, 500, 900, 1500]) loop.seek(t);
  return r.trace.join("\n");
}

// The property/value bits crush deliberately leaves alone must survive verbatim.
const RICH_SCENE = `
:root {
  width: 200px; height: 200px; background: #101020;
  --spin: 40deg;
  --glow: #ffcc00;
}

@keyframes drift {
  0% { transform: translate(0, 0); }
  100% { transform: translate(50px, var(--spin)); }
}

@define blob {
  type: circle; r: 12px; fill: var(--glow);
  > #core { type: circle; r: 4px; fill: #fff; }
}

#hero {
  type: group;
  transform: rotate(var(--spin));
  animation: drift 1s linear infinite;

  > #ring { type: circle; r: 30px; stroke: var(--glow); }
  > #shape { use: blob; }
  > #masked { type: rect; width: 40px; height: 40px; fill: #08f; mask: #shape alpha; }
}

.badge { type: rect; width: 10px; height: 10px; fill: #f0f; }

@machine mood {
  initial: calm;
  state calm { to: busy on click(#hero) when style(--spin > 10); }
  state busy { to: calm on complete; }
}
`;

test("crush renders identically to the original (rich scene)", () => {
  const crushed = serialize(parse(RICH_SCENE), { crush: true });
  // Sanity: crush actually shortened the human names.
  expect(crushed).not.toContain("hero");
  expect(crushed).not.toContain("drift");
  expect(crushed).not.toContain("--spin");
  expect(crushed).not.toContain("blob");
  // …but preserved external-meaning names (machine + input paths).
  expect(crushed).toContain("mood");
  expect(crushed).toContain("busy");

  // Crushed output must re-parse.
  const reparsed = parse(crushed);
  expect(reparsed.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );

  // And render the same frames.
  expect(renderTrace(crushed)).toBe(renderTrace(RICH_SCENE));
});

// The demo gallery is the smoke corpus: every shipped scene must crush to an
// identical render.
test("crush renders identically across the example gallery", () => {
  const dir = join(import.meta.dir, "../../../../examples/popkorn");
  const files = new Bun.Glob("*.css").scanSync({ cwd: dir });
  let count = 0;
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    const crushed = serialize(parse(src), { crush: true });
    expect(renderTrace(crushed), `${f} render drift after crush`).toBe(
      renderTrace(src),
    );
    count++;
  }
  expect(count).toBeGreaterThan(0);
});
