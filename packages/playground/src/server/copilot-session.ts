import { SYSTEM_PROMPT, TOOL_DEFS } from "../lib/agent-defs";
import { handleMcpMessage, type ToolCallResult, toMcpTools } from "./mcp";

// Minimal structural types for the workerd surface this class touches.
// NOTE: `wrangler types` globals collide with the DOM lib this package
// compiles against (see vite-env.d.ts), so these stay hand-rolled, same as
// lib/scenes.ts does for D1.
type SessionSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};
type DurableCtx = {
  acceptWebSocket(ws: SessionSocket): void;
  getWebSockets(): SessionSocket[];
};
declare const WebSocketPair: new () => { 0: SessionSocket; 1: SessionSocket };

const NOT_CONNECTED =
  "Playground tab not connected — open usepopkorn.dev, click Connect in the Copilot panel, and keep the tab open.";

const CALL_TIMEOUT_MS = 30_000;

/** Correlates relayed tool calls with their tab replies. In-memory only: an
 * in-flight MCP request keeps the DO active, and anything older than the
 * timeout is dead anyway. */
export class PendingCalls {
  // Seeded randomly, not from 1: a fresh DO instance after eviction must not
  // reuse ids from the evicted instance, or a stale tab reply arriving late
  // could settle the wrong call.
  private nextId = Math.floor(Math.random() * 2 ** 30);
  private pending = new Map<
    number,
    {
      settle: (r: ToolCallResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private timeoutMs = CALL_TIMEOUT_MS) {}

  create(): { id: number; promise: Promise<ToolCallResult> } {
    const id = this.nextId++;
    const promise = new Promise<ToolCallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          text: "Tool call timed out — the playground tab did not respond.",
          isError: true,
        });
      }, this.timeoutMs);
      this.pending.set(id, { settle: resolve, timer });
    });
    return { id, promise };
  }

  resolve(id: number, result: ToolCallResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.settle(result);
  }

  failAll(text: string): void {
    for (const [id] of this.pending) this.resolve(id, { text, isError: true });
  }
}

/** One Copilot session: the MCP http face for the user's agent and the
 * WebSocket face for the playground tab, bridged by PendingCalls. */
export class CopilotSession {
  private calls = new PendingCalls();
  // The connected agent's clientInfo.name, forwarded to the tab for display.
  // In-memory: lost on hibernation, resent on the next initialize.
  private clientName: string | null = null;

  constructor(private ctx: DurableCtx) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/tab")) return this.connectTab(request);
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let msg: unknown;
    try {
      msg = await request.json();
    } catch {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        { status: 400 },
      );
    }
    if (Array.isArray(msg)) {
      return new Response("Batching not supported", { status: 400 });
    }

    const m = msg as { method?: string; params?: any };
    if (m.method === "initialize") {
      this.clientName = m.params?.clientInfo?.name ?? null;
      this.sendToTab({ type: "client", name: this.clientName });
    }

    const res = await handleMcpMessage(msg, {
      tools: toMcpTools(TOOL_DEFS),
      instructions: SYSTEM_PROMPT,
      callTool: (name, args) => this.relay(name, args),
    });
    if (res === null) return new Response(null, { status: 202 });
    return Response.json(res);
  }

  private connectTab(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    // One tab per session — a reconnect replaces the previous socket.
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "replaced");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    if (this.clientName) {
      pair[1].send(JSON.stringify({ type: "client", name: this.clientName }));
    }
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
    } as ResponseInit & { webSocket: SessionSocket });
  }

  private sendToTab(frame: object): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        // Closing socket; the tab's reconnect handles it.
      }
    }
  }

  private relay(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const ws = this.ctx.getWebSockets()[0];
    if (!ws) return Promise.resolve({ text: NOT_CONNECTED, isError: true });
    const { id, promise } = this.calls.create();
    ws.send(JSON.stringify({ id, name, args }));
    return promise;
  }

  webSocketMessage(_ws: SessionSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    let frame: { id?: number; result?: string; isError?: boolean };
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof frame.id !== "number" || typeof frame.result !== "string")
      return;
    this.calls.resolve(frame.id, {
      text: frame.result,
      isError: frame.isError === true,
    });
  }

  webSocketClose(): void {
    this.calls.failAll(NOT_CONNECTED);
  }
}
