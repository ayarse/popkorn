import { useCallback, useEffect, useRef, useState } from "react";
import { examples as galleryExamples } from "@/examples";
import {
  type AgentConfig,
  GREETING,
  loadConfig,
  type Message,
  runAgent,
  SYSTEM_PROMPT,
  saveConfig,
  type ToolEvent,
} from "@/lib/agent";
import {
  buildOutline,
  executeTool,
  isToolError,
  TOOL_DEFS,
  type ToolContext,
} from "@/lib/agent-tools";

// The gallery scenes, exposed to the read_example tool for from-scratch few-shot.
// Keyed by the human label ("State machine: Pip") the loader already derives.
const AGENT_EXAMPLES = galleryExamples.map((e) => ({
  name: e.label,
  source: e.source,
}));

// Scenes under this many chars are inlined verbatim into the request (skips
// read round-trips); larger scenes send an outline and let the model read on
// demand.
const INLINE_SCENE_MAX = 3072;

function buildUserMessage(source: string, request: string): string {
  if (source.length < INLINE_SCENE_MAX) {
    return `Current scene (full source):\n\`\`\`css\n${source}\n\`\`\`\n\nRequest: ${request}`;
  }
  return `Current scene outline:\n${buildOutline(source)}\n(Use the read/search tools for the source itself.)\n\nRequest: ${request}`;
}

// A compact human label for a tool call, shown as a status row in the bubble.
function toolLabel(ev: ToolEvent): string {
  switch (ev.name) {
    case "get_outline":
      return "outline";
    case "read_rules": {
      const sel = ev.args.selectors;
      return Array.isArray(sel) ? `read ${sel.join(", ")}` : "read rules";
    }
    case "read_lines":
      return `read lines ${ev.args.start}–${ev.args.end}`;
    case "search":
      return `searched ${JSON.stringify(ev.args.query)}`;
    case "read_example":
      return ev.args.name ? `read example ${ev.args.name}` : "listed examples";
    case "apply_edit":
      return "edited scene";
    case "rewrite_scene":
      return "rewrote scene";
    default:
      return ev.name;
  }
}

// The Copilot chat state machine: message log, the streaming agent tool-loop,
// config, live per-edit apply to the scene, and per-run revert.
export function useAgentChat(
  source: string,
  onApplySource: (css: string) => void,
) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(() => loadConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const idRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const applyConfig = useCallback((cfg: AgentConfig) => {
    saveConfig(cfg);
    setConfig(cfg);
    setError(null);
    setSettingsOpen(false);
  }, []);

  const revert = useCallback(
    (messageId: number) => {
      const msg = messages.find((m) => m.id === messageId);
      if (msg?.revertTo !== undefined) onApplySource(msg.revertTo);
    },
    [messages, onApplySource],
  );

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || typing) return;
      setError(null);

      // History carries only bare request/summary text — never outlines or
      // source dumps — so prior turns stay compact.
      const history = messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
      setMessages((m) => [
        ...m,
        { id: idRef.current++, role: "user", text: body },
      ]);
      setInput("");
      setTyping(true);
      setStreamingId(null);

      if (!config) {
        setTyping(false);
        setError("Add your API key in settings to start chatting.");
        setSettingsOpen(true);
        return;
      }

      const apiMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: buildUserMessage(source, body) },
      ];

      const ac = new AbortController();
      abortRef.current = ac;

      // Live apply: every committed edit lands in the editor immediately and
      // the next tool call sees it. `changed` gates the revert affordance.
      const snapshot = source;
      let current = source;
      let changed = false;
      const ctx: ToolContext = {
        getSource: () => current,
        commit: (next) => {
          current = next;
          changed = true;
          onApplySource(next);
        },
        examples: AGENT_EXAMPLES,
      };

      // The streaming agent bubble is created lazily by the first token or
      // tool event, whichever comes first.
      let agentId = -1;
      const ensureAgent = () => {
        if (agentId === -1) {
          agentId = idRef.current++;
          const id = agentId;
          setStreamingId(id);
          setMessages((m) => [...m, { id, role: "agent", text: "" }]);
        }
        return agentId;
      };
      const onToken = (delta: string) => {
        const id = ensureAgent();
        setMessages((m) =>
          m.map((msg) =>
            msg.id === id ? { ...msg, text: msg.text + delta } : msg,
          ),
        );
      };
      // Reasoning deltas carry no text worth showing (see agent.ts), but their
      // arrival is what lazily creates the streaming bubble during a
      // reasoning-only lull — the bubble's persistent WorkingIndicator (see
      // agent-chat.tsx Bubble) covers the rest.
      const onReasoning = () => {
        ensureAgent();
      };
      const onToolEvent = (ev: ToolEvent) => {
        const id = ensureAgent();
        const entry = { label: toolLabel(ev), ok: !isToolError(ev.result) };
        setMessages((m) =>
          m.map((msg) =>
            msg.id === id
              ? { ...msg, toolEvents: [...(msg.toolEvents ?? []), entry] }
              : msg,
          ),
        );
      };

      try {
        await runAgent(config, apiMessages, {
          tools: TOOL_DEFS,
          executeTool: (name, args) => executeTool(name, args, ctx),
          signal: ac.signal,
          onToken,
          onReasoning,
          onToolEvent,
        });
      } catch (e: any) {
        if (!ac.signal.aborted) setError(e?.message ?? String(e));
      } finally {
        if (!ac.signal.aborted) {
          // If the run changed the scene, hang the pre-run snapshot off the
          // final agent message so the user can revert the whole run.
          if (changed && agentId !== -1) {
            const id = agentId;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === id ? { ...msg, revertTo: snapshot } : msg,
              ),
            );
          }
          setTyping(false);
          setStreamingId(null);
        }
      }
    },
    [typing, messages, config, source, onApplySource],
  );

  return {
    messages,
    input,
    setInput,
    typing,
    streamingId,
    error,
    config,
    settingsOpen,
    setSettingsOpen,
    applyConfig,
    send,
    revert,
  };
}
