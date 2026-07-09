import { parse } from "@popcorn/parser";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  type LucideIcon,
  Send,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyEdits, extractEdits } from "@/lib/edits";
import { cn } from "@/lib/utils";
import referenceMd from "../../../../.claude/skills/creating-popcorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popcorn-animations/SKILL.md?raw";

type Role = "user" | "agent";
type Message = {
  id: number;
  role: Role;
  text: string;
  parseError?: string;
  applied?: boolean;
};

type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = "popcorn.agent.config";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const DEFAULT_MODEL = "anthropic/claude-opus-4.8";

const MODEL_PRESETS = [
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.5",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "minimax/m3",
  "xiaomi/mimo-v2.5",
];

const SYSTEM_PROMPT = [
  "You are Popcorn Copilot, embedded in the Popcorn demo editor. Popcorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Output contract:",
  "- For a NEW animation or a full rewrite, reply with exactly ONE fenced ```css block containing the COMPLETE scene. It replaces the entire editor contents.",
  "- For a MODIFICATION to the existing scene, do NOT resend the whole scene. Instead reply with one or more fenced ```edit blocks, each an exact search/replace in this form:",
  "  ```edit",
  "  <<<<<<<",
  "  [text copied verbatim from the current scene]",
  "  =======",
  "  [replacement text]",
  "  >>>>>>>",
  "  ```",
  "  The search text (between <<<<<<< and =======) must match the current scene character-for-character, including whitespace and indentation, and must be unique in the scene. Keep it minimal — just enough lines to be unique. Never emit the whole scene for a small change. To delete, leave the replacement empty.",
  "- Prose: at most one or two short sentences before the block(s). For a pure question that changes nothing, reply with prose only and no blocks.",
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
  text: "I'm your Popcorn Copilot. Describe a new animation and I'll build it from scratch, or ask for a change and I'll edit the live scene. Questions about the DSL welcome too.",
};

const suggestions = [
  "Create a solar system animation from scratch",
  "Make the ball bounce twice as fast",
  "Change the palette to warm colors",
];

function loadConfig(): AgentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (!parsed.apiKey || !parsed.baseUrl) return null;
    return {
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      model: parsed.model ?? DEFAULT_MODEL,
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
  let last: string | null = null;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    last = match[1];
  }
  return last ? last.trim() : null;
}

async function streamLLM(
  cfg: AgentConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onToken: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
    throw new Error(`${res.status}: ${err.slice(0, 200)}`);
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fitInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: input is the re-run trigger — resize the textarea as its value changes
  useEffect(() => {
    fitInput();
  }, [input, fitInput]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are re-run triggers — scroll to bottom when content/state changes
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  if (!open) return null;

  return (
    <aside className="flex w-[384px] shrink-0 flex-col border-l border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-right-2">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">
            Popcorn Copilot
          </div>
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

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
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
                type="button"
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
        className="flex shrink-0 items-end gap-1.5 border-t border-border p-2"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Edit the live scene…"
          spellCheck={false}
          disabled={typing}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-ring disabled:opacity-50"
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
      type="button"
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
  const parts = text.split(/```(?:css|edit)?\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            // biome-ignore lint/suspicious/noArrayIndexKey: text split has no stable id; index is the natural key
            key={i}
            className="my-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono text-[11px] leading-snug"
          >
            {part}
          </pre>
        ) : part ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: text split has no stable id; index is the natural key
            key={i}
            className="whitespace-pre-wrap"
          >
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
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div className={cn("flex items-end gap-2", isUser && "flex-row-reverse")}>
        {!isUser && (
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
        )}
        <div
          className={cn(
            "max-w-[85%] break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
            isUser
              ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-secondary text-secondary-foreground",
          )}
        >
          {isUser ? message.text : <MessageBody text={message.text} />}
        </div>
      </div>
      {!isUser && message.applied && (
        <div className="ml-8 flex items-center gap-1 text-[11px] font-medium text-emerald-500">
          <Check className="size-3" />
          <span>Applied to editor</span>
        </div>
      )}
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

function ModelCombobox({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const exact = presets.some((p) => p === trimmed);
  const filtered = trimmed
    ? presets.filter((p) => p.toLowerCase().includes(lower))
    : presets;
  const showCustom = trimmed.length > 0 && !exact;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls="agent-model-listbox"
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors hover:border-border focus:border-primary/50"
      >
        <span className={value ? "truncate" : "text-muted-foreground"}>
          {value || "model id"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 opacity-60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          id="agent-model-listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-0 shadow-xl"
        >
          <Command shouldFilter={false} className="rounded-lg">
            <CommandInput
              placeholder="Search or type a model id…"
              value={search}
              onValueChange={setSearch}
              autoFocus
            />
            <CommandList>
              {filtered.length === 0 && !showCustom && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No preset matches.
                </div>
              )}
              <CommandGroup>
                {filtered.map((p) => (
                  <CommandItem key={p} value={p} onSelect={() => pick(p)}>
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value === p ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {p}
                  </CommandItem>
                ))}
                {showCustom && (
                  <CommandItem value={trimmed} onSelect={() => pick(trimmed)}>
                    <Sparkles className="size-4 shrink-0 text-primary" />
                    <span className="truncate">Use “{trimmed}”</span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
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
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [model, setModel] = useState(current?.model ?? DEFAULT_MODEL);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Bring your own key. Stored locally in your browser, never sent
            anywhere except the endpoint. Any OpenAI-compatible chat completions
            endpoint works; defaults to OpenRouter, switch the base URL for
            OpenAI or others.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="API key">
            <div className="flex items-center gap-1.5">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-…"
                spellCheck={false}
                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </Field>

          <Field label="Base URL">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
              placeholder={DEFAULT_BASE_URL}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
          </Field>

          <Field label="Model">
            <ModelCombobox
              value={model}
              onChange={setModel}
              presets={MODEL_PRESETS}
            />
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
                baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the field control is nested inside via children; biome can't see through the prop
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export default AgentChat;
