import { useCallback, useEffect, useRef, useState } from "react";
import { executeTool, isToolError, type ToolContext } from "@/lib/agent-tools";
import { handleTabFrame } from "./tab-frame";
import { AGENT_EXAMPLES, toolLabel } from "./use-agent-chat";

export type OwnAgentStatus = "idle" | "waiting" | "connected" | "disconnected";

export type OwnAgentEvent = { label: string; ok: boolean };

const MAX_EVENTS = 20;

const STORAGE_KEY = "popkorn.agent.mcp-session";

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

/** Bring-your-own-agent session: holds the tab side of the CopilotSession
 * WebSocket and executes relayed tool calls against the live editor buffer.
 * The session id is minted client-side and persisted in localStorage, so the
 * capability URL (the pairing) stays stable across reloads for this browser. */
export function useOwnAgent(
  source: string,
  onApplySource: (css: string) => void,
) {
  // NOTE: no agent-liveness signal — "connected" persists after the agent
  // exits; a last-activity timestamp is the upgrade path.
  const [status, setStatus] = useState<OwnAgentStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(() =>
    readStoredId(),
  );
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

  // Opens the tab socket for a given session id; shared by connect() (which
  // reuses or mints an id) and rotate() (which always mints a fresh one).
  const openSocket = useCallback((id: string) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/mcp/${id}/tab`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const ctx: ToolContext = {
        getSource: () => sourceRef.current,
        commit: (next) => {
          sourceRef.current = next;
          applyRef.current(next);
        },
        examples: AGENT_EXAMPLES,
      };
      const frame = handleTabFrame(e.data, {
        execute: (name, args) => executeTool(name, args, ctx),
        isError: (result) => isToolError(result),
      });
      if (frame === null) return;
      if (frame.kind === "client") {
        setClientName(frame.name);
        setStatus("connected");
        return;
      }
      setStatus("connected");
      setEvents((prev) => [
        ...prev.slice(-(MAX_EVENTS - 1)),
        {
          label: toolLabel({
            name: frame.name,
            args: frame.args,
            result: frame.result,
          }),
          ok: !frame.isError,
        },
      ]);
      ws.send(
        JSON.stringify({
          id: frame.id,
          result: frame.result,
          isError: frame.isError,
        }),
      );
    };

    ws.onclose = () => {
      if (wsRef.current === ws) setStatus("disconnected");
    };
  }, []);

  const connect = useCallback(() => {
    wsRef.current?.close();
    const id = sessionId ?? crypto.randomUUID();
    if (!sessionId) writeStoredId(id);
    setSessionId(id);
    setStatus("waiting");
    openSocket(id);
  }, [sessionId, openSocket]);

  // Mints a fresh session id (new capability URL) for when the old one
  // leaked or the user wants a clean break — closes the old socket first.
  const rotate = useCallback(() => {
    wsRef.current?.close();
    const id = crypto.randomUUID();
    writeStoredId(id);
    setSessionId(id);
    setStatus("waiting");
    openSocket(id);
  }, [openSocket]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    setClientName(null);
  }, []);

  // Auto-reconnect: a stored session id means an MCP client may already be
  // configured with its URL, so re-open the tab socket as soon as the
  // playground loads instead of waiting for the user to open the Copilot
  // panel. Runs once on mount; the wsRef guard keeps StrictMode's
  // double-invoke from opening two sockets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useEffect(() => {
    if (sessionId && !wsRef.current) connect();
  }, []);

  useEffect(
    () => () => {
      wsRef.current?.close();
      wsRef.current = null;
    },
    [],
  );

  const mcpUrl = sessionId ? `${location.origin}/mcp/${sessionId}` : null;
  return { status, mcpUrl, clientName, events, connect, rotate, disconnect };
}
