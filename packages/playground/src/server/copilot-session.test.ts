import { describe, expect, test } from "bun:test";
import { localToolResult, PendingCalls } from "./copilot-session";

describe("localToolResult", () => {
  test("read_docs returns the authoring guide", () => {
    const result = localToolResult("read_docs");
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(false);
    expect(result?.text.length).toBeGreaterThan(1000);
    expect(result?.text).toContain("## Quick reference");
  });

  test("anything else falls through to the tab relay", () => {
    expect(localToolResult("get_outline")).toBeNull();
  });
});

describe("PendingCalls", () => {
  test("resolve() settles the matching promise", async () => {
    const calls = new PendingCalls();
    const a = calls.create();
    const b = calls.create();
    expect(a.id).not.toBe(b.id);
    calls.resolve(b.id, { text: "second", isError: false });
    calls.resolve(a.id, { text: "first", isError: true });
    expect(await a.promise).toEqual({ text: "first", isError: true });
    expect(await b.promise).toEqual({ text: "second", isError: false });
  });

  test("resolve() with an unknown id is a no-op", () => {
    const calls = new PendingCalls();
    expect(() =>
      calls.resolve(999, { text: "x", isError: false }),
    ).not.toThrow();
  });

  test("double resolve keeps the first result", async () => {
    const calls = new PendingCalls();
    const a = calls.create();
    calls.resolve(a.id, { text: "one", isError: false });
    calls.resolve(a.id, { text: "two", isError: false });
    expect(await a.promise).toEqual({ text: "one", isError: false });
  });

  test("failAll() settles everything pending as a tool error", async () => {
    const calls = new PendingCalls();
    const a = calls.create();
    const b = calls.create();
    calls.failAll("tab disconnected");
    expect(await a.promise).toEqual({
      text: "tab disconnected",
      isError: true,
    });
    expect(await b.promise).toEqual({
      text: "tab disconnected",
      isError: true,
    });
  });

  test("times out with an in-band error", async () => {
    const calls = new PendingCalls(10);
    const a = calls.create();
    const result = await a.promise;
    expect(result.isError).toBe(true);
    expect(result.text).toContain("timed out");
  });
});
