// Pure parsing/dispatch for the CopilotSession WebSocket frames the
// playground tab receives. Kept dependency-free (no react/@/examples) so it
// tests under bun without pulling in the player/parser; use-own-agent.ts is
// the only caller and supplies the tool-execution deps.

export type TabFrameDeps = {
  execute(name: string, args: Record<string, unknown>): string;
  isError(result: string): boolean;
};

export type TabFrameResult =
  | { kind: "client"; name: string | null }
  | {
      kind: "reply";
      id: number;
      result: string;
      isError: boolean;
      name: string;
      args: Record<string, unknown>;
    }
  | null;

/** Parses one raw tab-socket message and, for a tool-call frame, executes it
 * via `deps.execute`. Returns null for malformed JSON or a frame that
 * matches neither the client-info nor tool-call shape. */
export function handleTabFrame(
  raw: string,
  deps: TabFrameDeps,
): TabFrameResult {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (msg && typeof msg === "object" && msg.type === "client") {
    return { kind: "client", name: msg.name ?? null };
  }
  if (typeof msg?.id !== "number" || typeof msg?.name !== "string") return null;

  const args = (msg.args ?? {}) as Record<string, unknown>;
  const result = deps.execute(msg.name, args);
  return {
    kind: "reply",
    id: msg.id,
    result,
    isError: deps.isError(result),
    name: msg.name,
    args,
  };
}
