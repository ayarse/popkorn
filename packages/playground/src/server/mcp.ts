// Minimal MCP (Model Context Protocol) server core for the bring-your-own-agent
// Copilot: exactly the three methods an MCP tool client needs — initialize,
// tools/list, tools/call — as pure functions with no I/O, so the Durable
// Object stays a thin transport and this layer tests under bun.
// NOTE: no SSE stream, notifications, resources, or prompts — plain JSON
// responses are all Claude Code's http transport requires; extend here if a
// client ever demands the stream.

export type OpenAiToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: object;
};

export type ToolCallResult = { text: string; isError: boolean };

export type McpDeps = {
  tools: McpTool[];
  instructions: string;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult>;
};

// Newest first; initialize echoes the client's version when we know it.
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export function toMcpTools(defs: OpenAiToolDef[]): McpTool[] {
  return defs.map((d) => ({
    name: d.function.name,
    description: d.function.description,
    inputSchema: d.function.parameters,
  }));
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, any>;
};

const ok = (id: JsonRpcRequest["id"], result: object) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  result,
});

const err = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

/** Handles one client JSON-RPC message. Returns the response envelope, or
 * null for notifications/responses (the HTTP layer answers 202). */
export async function handleMcpMessage(
  raw: unknown,
  deps: McpDeps,
): Promise<object | null> {
  const msg = raw as JsonRpcRequest;
  if (typeof msg?.method !== "string") {
    // A client *response* (has an id, no method) needs no reply; anything
    // else shapeless is an invalid request.
    return msg?.id !== undefined ? null : err(null, -32600, "Invalid request");
  }
  if (msg.method.startsWith("notifications/")) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "popkorn-copilot", version: "1.0.0" },
        instructions: deps.instructions,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: deps.tools });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string") {
        return err(msg.id, -32602, "tools/call requires params.name");
      }
      let result: ToolCallResult;
      try {
        result = await deps.callTool(name, msg.params?.arguments ?? {});
      } catch (e) {
        result = { text: (e as Error).message, isError: true };
      }
      return ok(msg.id, {
        content: [{ type: "text", text: result.text }],
        isError: result.isError,
      });
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
