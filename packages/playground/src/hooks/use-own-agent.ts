import { useCallback, useEffect, useRef, useState } from "react";
import { executeTool, isToolError, type ToolContext } from "@/lib/agent-tools";
import { AGENT_EXAMPLES, toolLabel } from "./use-agent-chat";

export type OwnAgentStatus = "idle" | "waiting" | "connected" | "disconnected";

export type OwnAgentEvent = { label: string; ok: boolean };

const MAX_EVENTS = 20;

/** Bring-your-own-agent session: holds the tab side of the CopilotSession
 * WebSocket and executes relayed tool calls against the live editor buffer.
 * The session id is minted client-side; the capability URL is the pairing. */
export function useOwnAgent(
  source: string,
  onApplySource: (css: string) => void,
) {
  const [status, setStatus] = useState<OwnAgentStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [events, setEvents] = useState<OwnAgentEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  // Refs so the long-lived socket handler always sees the current buffer and
  // apply callback; commit() also writes the ref directly because two tool
  // calls can land between React renders.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const applyRef = useRef(onApplySource);
  applyRef.current = onApplySource;

  const connect = useCallback(() => {
    wsRef.current?.close();
    const id = sessionId ?? crypto.randomUUID();
    setSessionId(id);
    setStatus("waiting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/mcp/${id}/tab`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "client") {
        setClientName(msg.name ?? null);
        setStatus("connected");
        return;
      }
      if (typeof msg.id !== "number" || typeof msg.name !== "string") return;
      setStatus("connected");
      const ctx: ToolContext = {
        getSource: () => sourceRef.current,
        commit: (next) => {
          sourceRef.current = next;
          applyRef.current(next);
        },
        examples: AGENT_EXAMPLES,
      };
      const args = (msg.args ?? {}) as Record<string, unknown>;
      const result = executeTool(msg.name, args, ctx);
      const ok = !isToolError(result);
      setEvents((prev) => [
        ...prev.slice(-(MAX_EVENTS - 1)),
        { label: toolLabel({ name: msg.name, args, result }), ok },
      ]);
      ws.send(JSON.stringify({ id: msg.id, result, isError: !ok }));
    };

    ws.onclose = () => {
      if (wsRef.current === ws) setStatus("disconnected");
    };
  }, [sessionId]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    setClientName(null);
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  const mcpUrl = sessionId ? `${location.origin}/mcp/${sessionId}` : null;
  return { status, mcpUrl, clientName, events, connect, disconnect };
}
