import { describe, expect, test } from "bun:test";
import { handleMcpMessage, type McpDeps, toMcpTools } from "./mcp";

const TOOLS = toMcpTools([
  {
    type: "function",
    function: {
      name: "get_outline",
      description: "Outline the scene",
      parameters: { type: "object", properties: {} },
    },
  },
]);

function deps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    tools: TOOLS,
    instructions: "You edit Popkorn scenes.",
    callTool: async () => ({ text: "ok", isError: false }),
    ...overrides,
  };
}

describe("toMcpTools", () => {
  test("maps OpenAI function defs to MCP tool shape", () => {
    expect(TOOLS).toEqual([
      {
        name: "get_outline",
        description: "Outline the scene",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });
});

describe("handleMcpMessage", () => {
  test("initialize returns capabilities, instructions, echoed protocol version", async () => {
    const res: any = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          clientInfo: { name: "claude-code" },
        },
      },
      deps(),
    );
    expect(res.id).toBe(0);
    expect(res.result.protocolVersion).toBe("2025-03-26");
    expect(res.result.capabilities).toEqual({ tools: {} });
    expect(res.result.instructions).toBe("You edit Popkorn scenes.");
    expect(res.result.serverInfo.name).toBe("popkorn-copilot");
  });

  test("initialize falls back to latest version when client's is unknown", async () => {
    const res: any = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      },
      deps(),
    );
    expect(res.result.protocolVersion).toBe("2025-06-18");
  });

  test("notifications return null", async () => {
    expect(
      await handleMcpMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        deps(),
      ),
    ).toBeNull();
  });

  test("ping returns empty result", async () => {
    const res: any = await handleMcpMessage(
      { jsonrpc: "2.0", id: 7, method: "ping" },
      deps(),
    );
    expect(res.result).toEqual({});
  });

  test("tools/list returns the tool list", async () => {
    const res: any = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      deps(),
    );
    expect(res.result.tools).toEqual(TOOLS);
  });

  test("tools/call forwards name and arguments and wraps the result", async () => {
    let seen: [string, Record<string, unknown>] | null = null;
    const res: any = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_outline", arguments: { a: 1 } },
      },
      deps({
        callTool: async (name, args) => {
          seen = [name, args];
          return { text: "the outline", isError: false };
        },
      }),
    );
    expect(seen).toEqual(["get_outline", { a: 1 }]);
    expect(res.result).toEqual({
      content: [{ type: "text", text: "the outline" }],
      isError: false,
    });
  });

  test("tools/call missing arguments defaults to {}", async () => {
    let seen: Record<string, unknown> | null = null;
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_outline" },
      },
      deps({
        callTool: async (_n, args) => {
          seen = args;
          return { text: "ok", isError: false };
        },
      }),
    );
    expect(seen).toEqual({});
  });

  test("tools/call surfaces tool errors in-band", async () => {
    const res: any = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_outline" },
      },
      deps({
        callTool: async () => ({ text: "tab not connected", isError: true }),
      }),
    );
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toBe("tab not connected");
  });

  test("tools/call converts a thrown error into an in-band tool error", async () => {
    const res: any = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_outline" },
      },
      deps({
        callTool: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("boom");
  });

  test("unknown method returns -32601", async () => {
    const res: any = await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "resources/list" },
      deps(),
    );
    expect(res.error.code).toBe(-32601);
  });

  test("malformed message returns -32600", async () => {
    const res: any = await handleMcpMessage({ hello: "world" }, deps());
    expect(res.error.code).toBe(-32600);
  });
});
