import { expect, test } from "bun:test";
import { compactPath, decodePath, type PathSeg } from "./path-codec.js";

function expectClose(a: PathSeg[], b: PathSeg[], tol = 0.005 + 1e-9): void {
  expect(b.map((s) => s.cmd)).toEqual(a.map((s) => s.cmd));
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < a[i].args.length; k++)
      expect(Math.abs(b[i].args[k] - a[i].args[k])).toBeLessThanOrEqual(tol);
}

const roundTrip = (d: string): string => {
  const out = compactPath(d);
  expectClose(decodePath(d)!, decodePath(out)!);
  return out;
};

const CASES = [
  "M 0 -179 C 98.86 -179 179 -98.86 179 0 C 179 98.86 98.86 179 0 179 Z",
  "M-.5.5.5-.5L1e-3 2E1 3.25e+1 .75",
  "M10 10 a5 5 0 0110 10 A5 5 30 1 0 .5.5 a2 3 45 1 1-4-4z",
  "M0 0 H10 V10 h-5 v-5 H0 Z",
  "M0 0 C1 1 2 2 3 3 S5 5 6 6 s1 1 2 2 Q9 9 10 10 T12 12 t1 1 q1 1 2 2",
  "M1 1 L5 5 Z l2 2 m3 3 l1 1 z L0 0",
  "M 1 2 3 4 5 6 m 1 1 2 2 3 3",
  "m1 2 3 4 z m5 5 1 1",
  "M1.234567 2.345678 L 100.004999 200.005001 L -0.004999 -0.005001",
  "M 0.55516486,42.77169 H 7.5795974 c 0.171066,0 0.3087834,0.137718 0.3087834,0.308784 v 10.627089 z",
];

test("compactPath round-trips every point within 0.005", () => {
  for (const d of CASES) roundTrip(d);
});

test("compactPath keeps command count and types", () => {
  for (const d of CASES) {
    const a = decodePath(d)!;
    const b = decodePath(compactPath(d))!;
    expect(b.length).toBe(a.length);
    expect(b.map((s) => s.cmd)).toEqual(a.map((s) => s.cmd));
  }
});

test("compactPath emits relative commands with minimal separators", () => {
  expect(
    compactPath(
      "M 0 -179 C 98.86 -179 179 -98.86 179 0 C 179 98.86 98.86 179 0 179 Z",
    ),
  ).toBe("m0-179c98.86 0 179 80.14 179 179 0 98.86-80.14 179-179 179z");
  expect(compactPath("M 0.5 0.25 L 1.5 -0.75")).toBe("m.5.25 1-1");
  expect(compactPath("M0 0 H1080 V1080 H0 Z")).toBe("m0 0h1080v1080H0z");
});

test("compactPath packs arc flags and keeps them parseable", () => {
  const out = roundTrip("M10 10 A 5 5 0 0 1 20 20 A 5 5 30 1 0 20.5 20.5");
  expect(out).toContain("0110 10");
  expect(decodePath(out)!.map((s) => s.args.slice(3, 5))).toEqual([
    [],
    [0, 1],
    [1, 0],
  ]);
});

test("compactPath has no accumulated rounding drift over long relative runs", () => {
  let d = "M0 0";
  let x = 0;
  for (let i = 0; i < 500; i++) {
    x += 0.123456;
    d += ` L ${x} ${x / 2}`;
  }
  const back = decodePath(compactPath(d))!;
  const last = back[back.length - 1].args;
  expect(Math.abs(last[0] - x)).toBeLessThanOrEqual(0.005);
  expect(Math.abs(last[1] - x / 2)).toBeLessThanOrEqual(0.005);
  roundTrip(d);
});

test("compactPath keeps more decimals for tiny paths", () => {
  const out = roundTrip("M0 0 L0.01234 0.05678 L0.1 0.1");
  const back = decodePath(out)!;
  expect(Math.abs(back[1].args[0] - 0.01234)).toBeLessThan(1e-4);
});

test("compactPath leaves malformed or non-path strings untouched", () => {
  for (const d of ["M1 2 L", "hello", "M1 2 L3 4 X", "M0 0 A1 1 0 2 0 3 3", ""])
    expect(compactPath(d)).toBe(d);
});

test("decodePath mirrors SVG implicit-command semantics", () => {
  expect(decodePath("m1 2 3 4 z l1 1")).toEqual([
    { cmd: "M", args: [1, 2] },
    { cmd: "L", args: [4, 6] },
    { cmd: "Z", args: [] },
    { cmd: "L", args: [2, 3] },
  ]);
});
