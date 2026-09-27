import { useEffect, useRef } from "react";
import { TOOL_DEFS } from "@/lib/agent-defs";
import { executeToolAsync } from "@/lib/agent-tools";
import { liveToolContext } from "./use-own-agent";

// Tools that only read the scene; everything else edits the live buffer.
const READ_ONLY = new Set([
  "get_outline",
  "read_rules",
  "read_lines",
  "search",
  "read_docs",
  "read_example",
  "render_frames",
]);

type ModelContext = {
  registerTool(tool: object, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): void;
};

/** WebMCP: exposes the Copilot's tools to an in-browser agent through
 * `document.modelContext` (Chrome 146+ behind a flag/origin trial). A no-op
 * where the API is absent. */
export function useWebMcp(
  source: string,
  onApplySource: (css: string) => void,
) {
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const applyRef = useRef(onApplySource);
  applyRef.current = onApplySource;

  useEffect(() => {
    // NOTE: Chrome <150 ships the older navigator.modelContext; drop it once the origin trial ends.
    type Host = { modelContext?: ModelContext };
    const mc =
      (document as Host).modelContext ?? (navigator as Host).modelContext;
    if (!mc) return;
    const ac = new AbortController();
    for (const { function: fn } of TOOL_DEFS) {
      const registered = mc.registerTool(
        {
          name: fn.name,
          description: fn.description,
          inputSchema: fn.parameters,
          annotations: { readOnlyHint: READ_ONLY.has(fn.name) },
          execute: async (args: Record<string, unknown>) => {
            const ctx = await liveToolContext(sourceRef, applyRef);
            const out = await executeToolAsync(fn.name, args ?? {}, ctx);
            if (!out.images?.length) return out.text;
            return {
              content: [
                { type: "text", text: out.text },
                ...out.images.map((img) => ({ type: "image", ...img })),
              ],
            };
          },
        },
        { signal: ac.signal },
      );
      // Spec registerTool returns a promise that rejects on a duplicate name.
      Promise.resolve(registered).catch(() => {});
    }
    return () => {
      ac.abort();
      for (const { function: fn } of TOOL_DEFS) {
        try {
          mc.unregisterTool?.(fn.name);
        } catch {}
      }
    };
  }, []);
}
