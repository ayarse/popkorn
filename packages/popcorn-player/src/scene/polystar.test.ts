import { test, expect } from 'bun:test';
import { polystarToCommands } from './polystar';
import type { PolystarData } from './types';

const base: Omit<PolystarData, 'type'> = {
  points: 5, outerRadius: 100, innerRadius: 50, rotation: 0,
  cx: 0, cy: 0, outerRoundness: 0, innerRoundness: 0,
};

// Round every coordinate in a command so float noise doesn't defeat toEqual.
function rounded(cmd: any) {
  const out: any = { type: cmd.type };
  for (const k of Object.keys(cmd)) {
    if (k === 'type') continue;
    out[k] = Math.round(cmd[k] * 1000) / 1000;
  }
  return out;
}

test('4-point star: alternating outer/inner vertices, first point up', () => {
  const cmds = polystarToCommands({ ...base, type: 'star', points: 4 });
  // M + 8 line segments (2*points) + Z.
  expect(cmds.length).toBe(1 + 8 + 1);
  expect(cmds[cmds.length - 1]).toEqual({ type: 'Z' });
  // Starts at the top outer vertex (rotation 0 => straight up, y is down => -r).
  expect(rounded(cmds[0])).toEqual({ type: 'M', x: 0, y: -100 });
  // First edge goes to the inner vertex at -45deg.
  const d = 50 * Math.SQRT1_2;
  expect(rounded(cmds[1])).toEqual({ type: 'L', x: Math.round(d * 1000) / 1000, y: Math.round(-d * 1000) / 1000 });
  // Third vertex is the next outer point, straight right.
  expect(rounded(cmds[2])).toEqual({ type: 'L', x: 100, y: 0 });
});

test('hexagon: 6 vertices on the outer radius, no inner radius', () => {
  const cmds = polystarToCommands({ ...base, type: 'polygon', points: 6 });
  expect(cmds.length).toBe(1 + 6 + 1);
  expect(rounded(cmds[0])).toEqual({ type: 'M', x: 0, y: -100 });
  // 60deg steps: (86.603, -50), (86.603, 50), (0, 100), ...
  expect(rounded(cmds[1])).toEqual({ type: 'L', x: 86.603, y: -50 });
  expect(rounded(cmds[2])).toEqual({ type: 'L', x: 86.603, y: 50 });
  expect(rounded(cmds[3])).toEqual({ type: 'L', x: 0, y: 100 });
});

test('rotation offsets the starting angle', () => {
  const cmds = polystarToCommands({ ...base, type: 'polygon', points: 4, rotation: 45 });
  // A square rotated 45deg from "point up": first vertex at -90+45 = -45deg.
  const d = 100 * Math.SQRT1_2;
  expect(rounded(cmds[0])).toEqual({ type: 'M', x: Math.round(d * 1000) / 1000, y: Math.round(-d * 1000) / 1000 });
});

test('cx/cy translate the whole shape', () => {
  const cmds = polystarToCommands({ ...base, type: 'polygon', points: 4, cx: 10, cy: 20 });
  expect(rounded(cmds[0])).toEqual({ type: 'M', x: 10, y: -80 });
});

test('roundness > 0 emits cubic beziers instead of straight lines', () => {
  const straight = polystarToCommands({ ...base, type: 'star', points: 5 });
  expect(straight.every((c) => c.type !== 'C')).toBe(true);

  const round = polystarToCommands({ ...base, type: 'star', points: 5, outerRoundness: 50, innerRoundness: 50 });
  const curves = round.filter((c) => c.type === 'C');
  expect(curves.length).toBe(10); // one per edge (2*points)
});
