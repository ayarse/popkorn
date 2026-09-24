// Pure parsing/dispatch for the CopilotSession WebSocket frames the
// playground tab receives. Kept dependency-free (no react/@/examples) so it
// tests under bun without pulling in the player/parser; use-own-agent.ts is
// the only caller and supplies the tool-execution deps.

import type { ToolImage, ToolOutput } from "../lib/agent-defs";

export type TabFrameDeps = {
  execute(
    name: string,
    args: Record<string, unknown>,
  ): string | ToolOutput | Promise<string | ToolOutput>;
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
      images?: ToolImage[];
    }
  | null;

/** Parses one raw tab-socket message and, for a tool-call frame, executes it
 * via `deps.execute`. Resolves null for malformed JSON or a frame that
 * matches neither the client-info nor tool-call shape. */
export async function handleTabFrame(
  raw: string,
  deps: TabFrameDeps,
): Promise<TabFrameResult> {
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
  const out = await deps.execute(msg.name, args);
  const { text, images } = typeof out === "string" ? { text: out } : out;
  return {
    kind: "reply",
    id: msg.id,
    result: text,
    isError: deps.isError(text),
    name: msg.name,
    args,
    ...(images?.length ? { images } : {}),
  };
}
