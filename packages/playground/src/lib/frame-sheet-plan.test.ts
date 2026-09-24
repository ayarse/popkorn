import { describe, expect, test } from "bun:test";
import { formatSeconds, gridCols, planSheet } from "./frame-sheet-plan";

describe("planSheet", () => {
  test("no times → six evenly spaced frames over one loop", () => {
    const plan = planSheet({}, 4000);
    expect(plan).toEqual({
      timesMs: [0, 667, 1333, 2000, 2667, 3333],
      cellWidth: 320,
      cols: 3,
      rows: 2,
    });
  });

  test("a static or unbounded scene defaults to the single frame at 0", () => {
    expect(planSheet({}, 0)).toMatchObject({ timesMs: [0], cols: 1, rows: 1 });
    expect(planSheet({}, Infinity)).toMatchObject({ timesMs: [0] });
  });

  test("requested seconds keep their order and convert to ms", () => {
    expect(planSheet({ times: [1.25, 0, 0.6] }, 4000)).toMatchObject({
      timesMs: [1250, 0, 600],
      cols: 3,
      rows: 1,
    });
  });

  test("width clamps to 160–480", () => {
    expect(planSheet({ width: 50 }, 1000)).toMatchObject({ cellWidth: 160 });
    expect(planSheet({ width: 2000 }, 1000)).toMatchObject({ cellWidth: 480 });
  });

  test("rejects bad times", () => {
    expect(planSheet({ times: [] }, 1000)).toHaveProperty("error");
    expect(planSheet({ times: "1,2" }, 1000)).toHaveProperty("error");
    expect(planSheet({ times: [-1] }, 1000)).toHaveProperty("error");
    expect(planSheet({ times: ["1"] }, 1000)).toHaveProperty("error");
    expect(
      planSheet({ times: Array.from({ length: 13 }, (_, i) => i) }, 1000),
    ).toHaveProperty("error");
  });
});

test("gridCols", () => {
  expect([1, 2, 3, 4, 5, 6, 9, 10, 12].map(gridCols)).toEqual([
    1, 2, 3, 2, 3, 3, 3, 4, 4,
  ]);
});

test("formatSeconds", () => {
  expect(formatSeconds(0)).toBe("0s");
  expect(formatSeconds(1250)).toBe("1.25s");
  expect(formatSeconds(667)).toBe("0.67s");
});
