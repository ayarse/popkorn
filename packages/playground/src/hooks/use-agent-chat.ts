import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentConfig,
  GREETING,
  loadConfig,
  type Message,
  type ReasoningEffort,
  runAgent,
  SYSTEM_PROMPT,
  saveConfig,
  type ToolEvent,
  toolLabel,
} from "@/lib/agent";
import { isToolError } from "@/lib/agent-defs";
import { loadAgentExamples } from "@/lib/agent-examples";
import { buildOutline, runTools, TOOL_DEFS } from "@/lib/agent-tools";
import { track } from "@/lib/analytics";

// Scenes under this many chars (~2K tokens, most gallery scenes) are inlined
// verbatim into the request: a read round-trip costs more than the tokens.
// Larger scenes send an outline and let the model read on demand.
const INLINE_SCENE_MAX = 8192;

function buildUserMessage(source: string, request: string): string {
  if (source.length < INLINE_SCENE_MAX) {
    return `Current scene (full source):\n\`\`\`css\n${source}\n\`\`\`\n\nRequest: ${request}`;
  }
  return `Current scene outline:\n${buildOutline(source)}\n(Use the read/search tools for the source itself.)\n\nRequest: ${request}`;
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
  // Latest render values, so send/revert stay referentially stable.
  const latest = useRef({ onApplySource, messages, config });
  latest.current = { onApplySource, messages, config };
  // The live editor source; the run's commits write it too, ahead of re-render.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Analytics: model/tool names only — never prompt text or the API key.
  const applyConfig = useCallback((cfg: AgentConfig) => {
    track("copilot_config_saved", { model: cfg.model });
    saveConfig(cfg);
    setConfig(cfg);
    setError(null);
    setSettingsOpen(false);
  }, []);

  const setReasoning = useCallback((reasoning: ReasoningEffort) => {
    const cfg = latest.current.config;
    if (!cfg) return;
    const next = { ...cfg, reasoning };
    saveConfig(next);
    setConfig(next);
  }, []);

  const revert = useCallback((messageId: number) => {
    const msg = latest.current.messages.find((m) => m.id === messageId);
    if (msg?.revertTo !== undefined) {
      track("copilot_revert");
      latest.current.onApplySource(msg.revertTo);
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body || abortRef.current) return;
    const { config, messages } = latest.current;
    const source = sourceRef.current;
    if (!config) {
      setError("Connect your own agent or add an API key to start chatting.");
      setSettingsOpen(true);
      return;
    }
    setError(null);

    // History carries only bare request/summary text — never outlines or
    // source dumps — so prior turns stay compact.
    const history = messages
      .filter((m) => m.id !== GREETING.id && m.text !== "")
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
    setMessages((m) => [
      ...m,
      { id: idRef.current++, role: "user", text: body, at: Date.now() },
    ]);
    setInput("");
    setTyping(true);
    setStreamingId(null);

    track("copilot_send", { model: config.model });

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: buildUserMessage(source, body) },
    ];

    const ac = new AbortController();
    abortRef.current = ac;

    // Live apply: every committed edit lands in the editor immediately and
    // the next tool call sees it, as do the user's own mid-run edits.
    const snapshot = source;
    const examples = await loadAgentExamples();
    const tools = runTools(
      sourceRef,
      (next) => latest.current.onApplySource(next),
      examples,
    );

    const patch = (id: number, fn: (msg: Message) => Message) =>
      setMessages((m) => m.map((msg) => (msg.id === id ? fn(msg) : msg)));

    // The streaming agent bubble is created lazily by the first token or
    // tool event, whichever comes first.
    let agentId = -1;
    const ensureAgent = () => {
      if (agentId === -1) {
        agentId = idRef.current++;
        const id = agentId;
        setStreamingId(id);
        setMessages((m) => [
          ...m,
          { id, role: "agent", text: "", at: Date.now() },
        ]);
      }
      return agentId;
    };

    // Token deltas are coalesced into one state update per animation frame.
    let pending = "";
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (!pending) return;
      const delta = pending;
      pending = "";
      patch(agentId, (msg) => ({ ...msg, text: msg.text + delta }));
    };
    const onToken = (delta: string) => {
      ensureAgent();
      pending += delta;
      frame ||= requestAnimationFrame(flush);
    };
    // Reasoning deltas carry no text worth showing, but their arrival lazily
    // creates the streaming bubble during a reasoning-only lull.
    const onReasoning = () => {
      ensureAgent();
    };
    const onToolEvent = (ev: ToolEvent) => {
      const id = ensureAgent();
      const entry = { label: toolLabel(ev), ok: !isToolError(ev.result) };
      patch(id, (msg) => ({
        ...msg,
        toolEvents: [...(msg.toolEvents ?? []), entry],
      }));
    };

    try {
      await runAgent(config, apiMessages, {
        tools: TOOL_DEFS,
        executeTool: tools.execute,
        signal: ac.signal,
        onToken,
        onReasoning,
        onToolEvent,
      });
    } catch (e: any) {
      if (!ac.signal.aborted) {
        track("copilot_error", { model: config.model });
        setError(e?.message ?? String(e));
      }
    } finally {
      cancelAnimationFrame(frame);
      flush();
      // If the run changed the scene, hang the pre-run snapshot off the
      // final agent message so the user can revert the whole run.
      if (tools.changed && agentId !== -1) {
        patch(agentId, (msg) => ({ ...msg, revertTo: snapshot }));
      }
      abortRef.current = null;
      setTyping(false);
      setStreamingId(null);
    }
  }, []);

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
    setReasoning,
    send,
    stop,
    revert,
  };
}
