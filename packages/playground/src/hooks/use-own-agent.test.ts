import { describe, expect, test } from "bun:test";
import { handleTabFrame } from "./tab-frame";

function deps(overrides: Partial<Parameters<typeof handleTabFrame>[1]> = {}) {
  return {
    execute: () => "ok",
    isError: () => false,
    ...overrides,
  };
}

describe("handleTabFrame", () => {
  test("malformed JSON returns null", async () => {
    expect(await handleTabFrame("not json", deps())).toBeNull();
  });

  test("client frame returns a client result", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ type: "client", name: "Claude Code" }),
      deps(),
    );
    expect(result).toEqual({ kind: "client", name: "Claude Code" });
  });

  test("client frame with no name reports null name", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ type: "client" }),
      deps(),
    );
    expect(result).toEqual({ kind: "client", name: null });
  });

  test("valid tool frame executes and returns a reply with matching id and isError", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 7, name: "get_outline", args: { foo: 1 } }),
      deps({
        execute: (name, args) => {
          expect(name).toBe("get_outline");
          expect(args).toEqual({ foo: 1 });
          return "outline text";
        },
        isError: (result) => result.startsWith("Error"),
      }),
    );
    expect(result).toEqual({
      kind: "reply",
      id: 7,
      result: "outline text",
      isError: false,
      name: "get_outline",
      args: { foo: 1 },
    });
  });

  test("valid tool frame surfaces isError from deps", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 3, name: "write_source", args: {} }),
      deps({
        execute: () => "Error: bad edit",
        isError: (result) => result.startsWith("Error"),
      }),
    );
    expect(result).toMatchObject({ kind: "reply", isError: true });
  });

  test("tool frame with missing args defaults to an empty object", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 1, name: "get_outline" }),
      deps({
        execute: (_name, args) => {
          expect(args).toEqual({});
          return "ok";
        },
      }),
    );
    expect(result).toMatchObject({ kind: "reply", args: {} });
  });

  test("frame with missing id returns null", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ name: "get_outline", args: {} }),
      deps(),
    );
    expect(result).toBeNull();
  });

  test("frame with wrong-typed id returns null", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: "7", name: "get_outline", args: {} }),
      deps(),
    );
    expect(result).toBeNull();
  });

  test("frame with missing name returns null", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 7, args: {} }),
      deps(),
    );
    expect(result).toBeNull();
  });

  test("frame with wrong-typed name returns null", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 7, name: 42, args: {} }),
      deps(),
    );
    expect(result).toBeNull();
  });

  test("unrecognized shapes (e.g. an array) return null", async () => {
    expect(await handleTabFrame(JSON.stringify([1, 2, 3]), deps())).toBeNull();
  });

  test("an image-bearing tool output rides on the reply", async () => {
    const result = await handleTabFrame(
      JSON.stringify({ id: 9, name: "render_frames", args: {} }),
      deps({
        execute: async () => ({
          text: "Rendered 1 frame(s)",
          images: [{ data: "abc", mimeType: "image/jpeg" }],
        }),
      }),
    );
    expect(result).toMatchObject({
      kind: "reply",
      result: "Rendered 1 frame(s)",
      images: [{ data: "abc", mimeType: "image/jpeg" }],
    });
  });
});
