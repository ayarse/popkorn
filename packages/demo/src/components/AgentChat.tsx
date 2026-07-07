import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  X,
  Settings,
  Eye,
  EyeOff,
  AlertCircle,
  ChevronDown,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { parse } from "@popcorn/parser";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import skillMd from "../../../../.claude/skills/creating-popcorn-animations/SKILL.md?raw";
import referenceMd from "../../../../.claude/skills/creating-popcorn-animations/reference.md?raw";

type Role = "user" | "agent";
type Message = { id: number; role: Role; text: string; parseError?: string };

type Provider = "openai" | "openrouter";

type AgentConfig = {
  provider: Provider;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = "popcorn.agent.config";

const BASE_URLS: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4.1-mini",
  openrouter: "anthropic/claude-sonnet-4",
};

const MODEL_PRESETS: Record<Provider, string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  openrouter: [
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-flash",
  ],
};

const SYSTEM_PROMPT = [
  "You are Popcorn Copilot, embedded in the Popcorn demo editor. Popcorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Output contract:",
  "- When the user asks you to create or change an animation, reply with one or two sentences of prose, then exactly ONE fenced ```css code block containing the COMPLETE scene. Never emit a diff, fragment, or partial scene — the code block replaces the entire editor contents.",
  "- For pure questions that do not change the scene, reply with prose only and no code block.",
  "- Keep prose brief; put all the detail in the scene.",
  "",
  "The following is your authoritative knowledge of the Popcorn language. Follow it exactly.",
  "",
  "=== SKILL.md ===",
  skillMd,
  "",
  "=== reference.md ===",
  referenceMd,
].join("\n");

const GREETING: Message = {
  id: 0,
  role: "agent",
  text: "I'm your Popcorn Copilot — I edit the scene that's live in the editor. Ask me to create or tweak an animation and the canvas updates instantly, or ask a question about the DSL.",
};

const suggestions = [
  "Make the ball bounce twice as fast",
  "Add a spinning star",
  "How do motion paths work?",
];

function loadConfig(): AgentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (!parsed.apiKey || !parsed.provider) return null;
    if (parsed.provider !== "openai" && parsed.provider !== "openrouter") return null;
    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      model: parsed.model ?? DEFAULT_MODELS[parsed.provider],
    };
  } catch {
    return null;
  }
}

function saveConfig(cfg: AgentConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function wrapScene(source: string, request: string): string {
  return `Current scene:\n\`\`\`css\n${source}\n\`\`\`\n\nRequest: ${request}`;
}

function extractCss(text: string): string | null {
  const re = /```css\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = re.exec(text))) last = match[1];
  return last ? last.trim() : null;
}

async function streamLLM(
  cfg: AgentConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onToken: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE_URLS[cfg.provider]}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${PROVIDER_LABELS[cfg.provider]} ${res.status}: ${err.slice(0, 200)}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // keepalive or partial frame — ignore
      }
    }
  }
  return full;
}

export type AgentChatProps = {
  open: boolean;
  onClose: () => void;
  source: string;
  onApplySource: (css: string) => void;
};

function AgentChat({ open, onClose, source, onApplySource }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(() => loadConfig());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing, open, error]);

  useEffect(() => {
    return () => abortRef.current?.abort();
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
          setMessages((m) => [...m, { id: agentId, role: "agent", text: reply }]);
        }
        const css = extractCss(reply);
        if (css) {
          try {
            parse(css);
            onApplySource(css);
          } catch (e: any) {
            const detail = e?.message ?? String(e);
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentId
                  ? { ...msg, parseError: `Generated scene failed to parse: ${detail}` }
                  : msg,
              ),
            );
          }
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  if (!open) return null;

  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-l border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-right-2">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">Popcorn Copilot</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {config ? `${config.model}` : "Not configured"}
          </div>
        </div>
        <HeaderIconButton
          icon={Settings}
          label="Agent settings"
          onClick={() => setSettingsOpen(true)}
        />
        <HeaderIconButton icon={X} label="Close chat" onClick={onClose} />
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {typing && streamingId === null && <TypingBubble />}
        {error && (
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {messages.length <= 1 && !typing && !error && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-1.5 border-t border-border p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Edit the live scene…"
          spellCheck={false}
          disabled={typing}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => send(input)}
          disabled={typing || !input.trim()}
          aria-label="Send message"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          {typing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>

      {settingsOpen && (
        <SettingsDialog
          current={config}
          onSave={(cfg) => {
            saveConfig(cfg);
            setConfig(cfg);
            setError(null);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </aside>
  );
}

function HeaderIconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}

function MessageBody({ text }: { text: string }) {
  const parts = text.split(/```(?:css)?\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="my-1 max-h-40 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-snug"
          >
            {part}
          </pre>
        ) : part ? (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        ) : null,
      )}
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div className={cn("flex items-end gap-2", isUser && "flex-row-reverse")}>
        {!isUser && (
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
        )}
        <div
          className={cn(
            "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
            isUser
              ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-secondary text-secondary-foreground",
          )}
        >
          {isUser ? message.text : <MessageBody text={message.text} />}
        </div>
      </div>
      {message.parseError && (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{message.parseError}</span>
        </div>
      )}
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
        <Sparkles className="size-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function SettingsDialog({
  current,
  onSave,
  onClose,
}: {
  current: AgentConfig | null;
  onSave: (cfg: AgentConfig) => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<Provider>(current?.provider ?? "openai");
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [model, setModel] = useState(
    current?.model ?? DEFAULT_MODELS[current?.provider ?? "openai"],
  );
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const switchProvider = (p: Provider) => {
    setProvider(p);
    setModel(DEFAULT_MODELS[p]);
  };

  const presets = MODEL_PRESETS[provider];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Bring your own key. Stored locally in your browser — never sent anywhere except the provider.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Provider">
            <div className="flex gap-1.5 rounded-lg border border-border bg-background p-0.5">
              {(["openai", "openrouter"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => switchProvider(p)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    provider === p
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="API key">
            <div className="flex items-center gap-1.5">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "openai" ? "sk-…" : "sk-or-…"}
                spellCheck={false}
                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>

          <Field label="Model">
            <div className="relative">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                spellCheck={false}
                list="agent-model-presets"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 pr-8 text-[13px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-ring"
                placeholder="model id"
              />
              <datalist id="agent-model-presets">
                {presets.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!apiKey.trim()}
            onClick={() =>
              onSave({
                provider,
                apiKey: apiKey.trim(),
                model,
              })
            }
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export default AgentChat;
