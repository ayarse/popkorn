import { parse } from "@popkorn/parser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentConfig,
  extractCss,
  GREETING,
  loadConfig,
  type Message,
  SYSTEM_PROMPT,
  saveConfig,
  streamLLM,
  wrapScene,
} from "@/lib/agent";
import { applyEdits, extractEdits } from "@/lib/edits";

// The Copilot chat state machine: message log, streaming send loop, config, and
// applying a reply (full ```css rewrite or ```edit search/replace) to the scene.
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

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || typing) return;
      setError(null);

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
        { role: "user", content: wrapScene(source, body) },
      ];

      const ac = new AbortController();
      abortRef.current = ac;
      let agentId = -1;
      const onToken = (delta: string) => {
        setMessages((m) => {
          if (agentId === -1) {
            agentId = idRef.current++;
            setStreamingId(agentId);
            return [...m, { id: agentId, role: "agent", text: delta }];
          }
          return m.map((msg) =>
            msg.id === agentId ? { ...msg, text: msg.text + delta } : msg,
          );
        });
      };

      try {
        const reply = await streamLLM(config, apiMessages, ac.signal, onToken);
        if (ac.signal.aborted) return;
        if (agentId === -1) {
          agentId = idRef.current++;
          setMessages((m) => [
            ...m,
            { id: agentId, role: "agent", text: reply },
          ]);
        }
        const fail = (msg: string) =>
          setMessages((m) =>
            m.map((x) => (x.id === agentId ? { ...x, parseError: msg } : x)),
          );
        const markApplied = () =>
          setMessages((m) =>
            m.map((x) => (x.id === agentId ? { ...x, applied: true } : x)),
          );
        const applyScene = (css: string) => {
          try {
            parse(css);
            onApplySource(css);
            markApplied();
          } catch (e: any) {
            fail(`Generated scene failed to parse: ${e?.message ?? String(e)}`);
          }
        };
        const edits = extractEdits(reply);
        if (edits.length > 0) {
          const applied = applyEdits(source, edits);
          if (!applied.ok) fail(applied.error);
          else applyScene(applied.result);
        } else {
          const css = extractCss(reply);
          if (css) applyScene(css);
        }
      } catch (e: any) {
        if (ac.signal.aborted) return;
        setError(e.message ?? String(e));
      } finally {
        if (!ac.signal.aborted) {
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
  };
}
