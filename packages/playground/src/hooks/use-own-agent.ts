import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toolLabel } from "@/lib/agent";
import { isToolError } from "@/lib/agent-defs";
import { loadAgentExamples } from "@/lib/agent-examples";
import { executeTool, type ToolContext } from "@/lib/agent-tools";
import { track } from "@/lib/analytics";
import { handleTabFrame } from "./tab-frame";

export type OwnAgentStatus = "idle" | "waiting" | "connected" | "disconnected";

// `at` is the event's arrival time (ms epoch).
export type OwnAgentEvent = { label: string; ok: boolean; at: number };

const MAX_EVENTS = 20;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

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
 * The session id is minted client-side and persisted in localStorage, and on
 * the Clerk account when signed in, so the capability URL (the pairing) stays
 * stable across reloads, browsers, and devices. */
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
  const retryRef = useRef<{
    attempt: number;
    timer?: ReturnType<typeof setTimeout>;
  }>({ attempt: 0 });
  // Refs so the long-lived socket handler always sees the current buffer and
  // apply callback; commit() also writes the ref directly because two tool
  // calls can land between React renders.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const applyRef = useRef(onApplySource);
  applyRef.current = onApplySource;

  // Signed in, the account's id wins over this browser's: one URL everywhere.
  const { user } = useUser();
  const accountId =
    typeof user?.unsafeMetadata.mcpSession === "string"
      ? user.unsafeMetadata.mcpSession
      : null;
  const persist = useCallback(
    (id: string) => {
      writeStoredId(id);
      if (user && accountId !== id) {
        user
          .update({
            unsafeMetadata: { ...user.unsafeMetadata, mcpSession: id },
          })
          .catch(() => {}); // this browser still has it; retried next load
      }
    },
    [user, accountId],
  );

  // Opens the tab socket for a given session id; shared by connect() (which
  // reuses or mints an id) and rotate() (which always mints a fresh one).
  const openSocket = useCallback((id: string) => {
    clearTimeout(retryRef.current.timer);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/mcp/${id}/tab`);
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current.attempt = 0;
    };

    ws.onmessage = async (e) => {
      if (typeof e.data !== "string") return;
      const examples = await loadAgentExamples();
      const ctx: ToolContext = {
        getSource: () => sourceRef.current,
        commit: (next) => {
          sourceRef.current = next;
          applyRef.current(next);
        },
        examples,
      };
      const frame = handleTabFrame(e.data, {
        execute: (name, args) => executeTool(name, args, ctx),
        isError: isToolError,
      });
      if (frame === null) return;
      if (frame.kind === "client") {
        // Analytics: client and tool names only — no scene source or args.
        track("mcp_client", { client: frame.name ?? "unknown" });
        setClientName(frame.name);
        setStatus("connected");
        return;
      }
      track("mcp_tool", { tool: frame.name, ok: frame.isError ? 0 : 1 });
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
          at: Date.now(),
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

    // Reconnects with exponential backoff unless another tab took over the
    // session (server close reason "replaced").
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return;
      setStatus("disconnected");
      if (e.reason === "replaced") return;
      const retry = retryRef.current;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** retry.attempt++,
      );
      retry.timer = setTimeout(() => {
        if (wsRef.current !== ws) return;
        setStatus("waiting");
        openSocket(id);
      }, delay);
    };
  }, []);

  const connect = useCallback(() => {
    wsRef.current?.close();
    const id = sessionId ?? crypto.randomUUID();
    // Fires only on a first mint, so auto-reconnects don't inflate the count —
    // pairs with mcp_client as the "minted a URL → an agent showed up" funnel.
    if (!sessionId) {
      track("mcp_session_start");
      persist(id);
    }
    setSessionId(id);
    setStatus("waiting");
    openSocket(id);
  }, [sessionId, openSocket, persist]);

  // Mints a fresh session id (new capability URL) for when the old one
  // leaked or the user wants a clean break — closes the old socket first.
  const rotate = useCallback(() => {
    wsRef.current?.close();
    const id = crypto.randomUUID();
    persist(id);
    setSessionId(id);
    setStatus("waiting");
    openSocket(id);
  }, [openSocket, persist]);

  const disconnect = useCallback(() => {
    clearTimeout(retryRef.current.timer);
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

  // Account sync once Clerk loads: adopt the account's id (re-opening a live
  // socket on it), or upload this browser's existing pairing if it has none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the account id only
  useEffect(() => {
    if (!user) return;
    if (!accountId) {
      if (sessionId) persist(sessionId);
      return;
    }
    if (accountId === sessionId) return;
    writeStoredId(accountId);
    setSessionId(accountId);
    if (wsRef.current) {
      wsRef.current.close();
      setStatus("waiting");
      openSocket(accountId);
    }
  }, [user?.id, accountId]);

  useEffect(
    () => () => {
      clearTimeout(retryRef.current.timer);
      wsRef.current?.close();
      wsRef.current = null;
    },
    [],
  );

  const mcpUrl = sessionId ? `${location.origin}/mcp/${sessionId}` : null;
  return { status, mcpUrl, clientName, events, connect, rotate, disconnect };
}
