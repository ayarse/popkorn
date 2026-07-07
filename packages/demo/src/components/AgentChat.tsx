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
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Role = "user" | "agent";
type Message = { id: number; role: Role; text: string };

type Provider = "openai" | "anthropic" | "custom";

type AgentConfig = {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

const STORAGE_KEY = "popcorn.agent.config";

const FIXED_BASE_URLS: Record<Exclude<Provider, "custom">, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom (OpenAI-compatible)",
};

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  custom: "openai/gpt-4o",
};

const MODEL_PRESETS: Record<Provider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  anthropic: [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-sonnet-4-20250514",
  ],
  custom: [
    "openai/gpt-4o",
    "anthropic/claude-3.5-sonnet",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
  ],
};

const SYSTEM_PROMPT =
  "You are Popcorn Copilot, an expert assistant for the Popcorn animation DSL — a CSS-subset language that renders to Canvas2D. " +
  "Help the user author and debug Popcorn scenes: shapes, keyframes, motion paths (offset-path), masks, symbols, var()/input() bindings. " +
  "Reference the CSS idiom: motion paths are offset-path/offset-distance/offset-rotate, holds are step-end, staggering is negative animation-delay, layering is z-index. " +
  "When suggesting code, emit valid Popcorn CSS. Be concise.";

const GREETING: Message = {
  id: 0,
  role: "agent",
  text: "I'm your Popcorn Copilot — tell me what you want to animate and I'll draft the DSL, or paste a scene and I'll review it.",
};

const suggestions = [
  "Animate a bouncing ball",
  "How do motion paths work?",
  "Review my scene for errors",
];

function loadConfig(): AgentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (!parsed.apiKey || !parsed.provider) return null;
    const provider = parsed.provider as Provider;
    if (!parsed.model) parsed.model = DEFAULT_MODELS[provider];
    parsed.baseUrl =
      provider === "custom"
        ? parsed.baseUrl ?? "https://openrouter.ai/api/v1"
        : FIXED_BASE_URLS[provider as "openai" | "anthropic"];
    return parsed as AgentConfig;
  } catch {
    return null;
  }
}

function saveConfig(cfg: AgentConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

async function callLLM(
  cfg: AgentConfig,
  history: Message[],
): Promise<string> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];

  if (cfg.provider === "openai" || cfg.provider === "custom") {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${PROVIDER_LABELS[cfg.provider]} ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "(no response)";
  }

  const res = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      })),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "(no response)";
}

export type AgentChatProps = {
  open: boolean;
  onClose: () => void;
};

function AgentChat({ open, onClose }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
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

      const userMsg: Message = { id: idRef.current++, role: "user", text: body };
      const next = [...messages, userMsg];
      setMessages(next);
      setInput("");
      setTyping(true);

      if (!config) {
        setTyping(false);
        setError("Add your API key in settings to start chatting.");
        setSettingsOpen(true);
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const reply = await callLLM(config, next);
        if (ac.signal.aborted) return;
        setMessages((m) => [
          ...m,
          { id: idRef.current++, role: "agent", text: reply },
        ]);
      } catch (e: any) {
        if (ac.signal.aborted) return;
        setError(e.message ?? String(e));
      } finally {
        if (!ac.signal.aborted) setTyping(false);
      }
    },
    [typing, messages, config],
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
        {typing && <TypingBubble />}
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
          placeholder="Describe an animation…"
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

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex items-end gap-2", isUser && "flex-row-reverse")}>
      {!isUser && (
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
          <Sparkles className="size-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
          isUser
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-secondary text-secondary-foreground",
        )}
      >
        {message.text}
      </div>
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
  const [baseUrl, setBaseUrl] = useState(
    current?.baseUrl ??
      (current?.provider === "custom"
        ? "https://openrouter.ai/api/v1"
        : FIXED_BASE_URLS[(current?.provider ?? "openai") as "openai" | "anthropic"]),
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
    setBaseUrl(
      p === "custom"
        ? "https://openrouter.ai/api/v1"
        : FIXED_BASE_URLS[p as "openai" | "anthropic"],
    );
  };

  const presets = MODEL_PRESETS[provider];
  const resolvedBaseUrl =
    provider === "custom"
      ? baseUrl
      : FIXED_BASE_URLS[provider as "openai" | "anthropic"];

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
          {/* Provider */}
          <Field label="Provider">
            <div className="flex gap-1.5 rounded-lg border border-border bg-background p-0.5">
              {(["openai", "anthropic", "custom"] as Provider[]).map((p) => (
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
                  {p === "custom" ? "Custom" : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </Field>

          {/* Base URL — editable only for custom provider */}
          <Field label="Base URL">
            <input
              value={resolvedBaseUrl}
              onChange={(e) => provider === "custom" && setBaseUrl(e.target.value)}
              readOnly={provider !== "custom"}
              spellCheck={false}
              className={cn(
                "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring",
                provider !== "custom" && "cursor-default opacity-60",
                provider === "custom" && "placeholder:text-muted-foreground focus:border-primary/50",
              )}
              placeholder="https://openrouter.ai/api/v1"
            />
          </Field>

          {/* API key */}
          <Field label="API key">
            <div className="flex items-center gap-1.5">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider === "openai"
                    ? "sk-…"
                    : provider === "anthropic"
                      ? "sk-ant-…"
                      : "your-api-key"
                }
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

          {/* Model */}
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
                baseUrl: resolvedBaseUrl,
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