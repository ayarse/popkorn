import {
  AlertCircle,
  Brain,
  type LucideIcon,
  Plug,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { marked } from "marked";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ConnectAgent } from "@/components/agent/connect-agent";
import { randomVerb } from "@/components/agent/working-verbs";
import { Alert } from "@/components/ui/alert";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { type OwnAgentEvent, useOwnAgent } from "@/hooks/use-own-agent";
import { type Message, type ReasoningEffort, SUGGESTIONS } from "@/lib/agent";
import { cn } from "@/lib/utils";

const AgentSettings = lazy(() =>
  import("@/components/agent/agent-settings").then((m) => ({
    default: m.AgentSettings,
  })),
);

// How long the own-agent log keeps its working indicator after an event.
const OWN_AGENT_ACTIVE_MS = 4000;

// Distance from the bottom (px) within which new content keeps auto-scrolling.
const STICK_THRESHOLD = 48;

type ChatItem =
  | { kind: "message"; message: Message }
  | { kind: "log"; key: number; events: OwnAgentEvent[] };

// Messages and own-agent tool events interleaved by time; consecutive events
// collapse into one log.
function chatItems(messages: Message[], events: OwnAgentEvent[]): ChatItem[] {
  const items: ChatItem[] = [];
  let e = 0;
  const pushEventsBefore = (t: number) => {
    const run: OwnAgentEvent[] = [];
    while (e < events.length && events[e].at < t) run.push(events[e++]);
    if (run.length) items.push({ kind: "log", key: run[0].at, events: run });
  };
  for (const m of messages) {
    pushEventsBefore(m.at);
    items.push({ kind: "message", message: m });
  }
  pushEventsBefore(Number.POSITIVE_INFINITY);
  return items;
}

export type AgentChatProps = {
  open: boolean;
  onClose: () => void;
  source: string;
  onApplySource: (css: string) => void;
  fullscreen?: boolean;
};

function AgentChat({
  open,
  onClose,
  source,
  onApplySource,
  fullscreen,
}: AgentChatProps) {
  const {
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
  } = useAgentChat(source, onApplySource);
  const own = useOwnAgent(source, onApplySource);
  const [connectOpen, setConnectOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are re-run triggers — follow new content while pinned to the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing, open, error, own.events, own.status]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) {
      stickRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    }
  };

  const submit = (text: string) => {
    stickRef.current = true;
    send(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  const items = useMemo(
    () => chatItems(messages, own.events),
    [messages, own.events],
  );
  const lastEventAt = own.events[own.events.length - 1]?.at;

  if (!open) return null;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-popover/95 text-popover-foreground backdrop-blur-sm animate-in fade-in-0"
          : "flex w-[384px] shrink-0 flex-col border-l border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-right-2"
      }
    >
      <div
        className={cn(
          "flex h-full flex-col",
          fullscreen && "mx-auto w-full max-w-3xl",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <AgentAvatar large />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">
              Popkorn Copilot
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {own.status === "connected"
                ? `${own.clientName ?? "Your agent"} connected`
                : config
                  ? `${config.model}`
                  : "Not configured"}
            </div>
          </div>
          <HeaderIconButton
            icon={Plug}
            label="Use your own agent"
            onClick={() => setConnectOpen(true)}
          />
          <HeaderIconButton
            icon={Settings}
            label="Agent settings"
            onClick={() => setSettingsOpen(true)}
          />
          <HeaderIconButton icon={X} label="Close chat" onClick={onClose} />
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex flex-1 flex-col gap-3 overflow-y-auto p-3"
        >
          {items.map((item) =>
            item.kind === "message" ? (
              <Bubble
                key={item.message.id}
                message={item.message}
                onRevert={revert}
                streaming={typing && streamingId === item.message.id}
              />
            ) : (
              <ToolLog
                key={`log-${item.key}`}
                events={item.events}
                activeSince={
                  item.events[item.events.length - 1].at === lastEventAt
                    ? lastEventAt
                    : undefined
                }
              />
            ),
          )}
          {typing && streamingId === null && <TypingBubble />}
          {error && (
            <Alert variant="destructive" className="text-[11px]">
              <AlertCircle />
              <span>{error}</span>
            </Alert>
          )}
          {messages.length <= 1 &&
            !typing &&
            !error &&
            (!config && own.status === "idle" ? (
              <SetupChooser
                onConnect={() => setConnectOpen(true)}
                onBringKey={() => setSettingsOpen(true)}
              />
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => submit(s)}
                    className={cn(
                      badgeVariants({ variant: "outline" }),
                      "py-1 font-normal hover:border-primary/40 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 items-end gap-1.5 border-t border-border p-2"
        >
          <ReasoningControl
            value={config?.reasoning}
            onChange={setReasoning}
            disabled={!config}
          />
          <Textarea
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
                submit(input);
              }
            }}
            rows={1}
            placeholder="Edit the live scene…"
            spellCheck={false}
            disabled={typing}
            className="max-h-40 min-h-9 w-auto flex-1 resize-none py-2 font-sans text-[13px] transition-colors focus:border-primary/50 disabled:opacity-50"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                onClick={typing ? stop : () => submit(input)}
                disabled={!typing && !input.trim()}
                aria-label={typing ? "Stop" : "Send message"}
                className="size-9 shrink-0 rounded-lg disabled:opacity-40"
              >
                {typing ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <Send />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{typing ? "Stop" : "Send (Enter)"}</TooltipContent>
          </Tooltip>
        </form>

        {settingsOpen && (
          <Suspense fallback={null}>
            <AgentSettings
              current={config}
              onSave={applyConfig}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        )}
        {connectOpen && (
          <ConnectAgent
            status={own.status}
            mcpUrl={own.mcpUrl}
            clientName={own.clientName}
            onConnect={own.connect}
            onDisconnect={own.disconnect}
            onRotate={own.rotate}
            onClose={() => setConnectOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// A quiet muted "<Verb>…" row: one random verb per mount, rerolled every 5–10s
// while it stays on screen. Reuses the tool-status-row look.
function WorkingIndicator() {
  const [verb, setVerb] = useState(randomVerb);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(
        () => {
          setVerb(randomVerb());
          tick();
        },
        5000 + Math.random() * 5000,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
      <span className="size-1 shrink-0 animate-pulse rounded-full bg-muted-foreground/50" />
      <span className="min-w-0 truncate" title={`${verb}…`}>
        {verb}…
      </span>
    </div>
  );
}

const REASONING_MODES: { value: ReasoningEffort; label: string }[] = [
  { value: "default", label: "Model default" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// Composer-side reasoning-effort picker. Copies the toolbar trigger nesting
// (Tooltip > TooltipTrigger > DropdownMenuTrigger > Button, all asChild). The
// Brain icon goes accent-colored whenever a non-default mode is active so the
// current setting is glanceable.
function ReasoningControl({
  value,
  onChange,
  disabled,
}: {
  value: ReasoningEffort | undefined;
  onChange: (r: ReasoningEffort) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Reasoning effort"
              className={cn(
                "size-9 shrink-0",
                value && value !== "default" && "text-primary",
              )}
            >
              <Brain className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Reasoning effort</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="w-40">
        <DropdownMenuRadioGroup
          value={value ?? "default"}
          onValueChange={(v) => onChange(v as ReasoningEffort)}
        >
          {REASONING_MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value}>
              {m.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// First-open empty state, shown in place of suggestion chips until either an
// agent connects or a key is saved — the chips otherwise just error.
function SetupChooser({
  onConnect,
  onBringKey,
}: {
  onConnect: () => void;
  onBringKey: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="text-[11px] text-muted-foreground">
        Two ways to use Copilot:
      </div>
      <SetupOption
        icon={Plug}
        label="Connect your agent"
        caption="Drive edits from Claude Code, Codex, or any MCP client"
        onClick={onConnect}
      />
      <SetupOption
        icon={Settings}
        label="Bring your own key"
        caption="Chat here via any OpenAI-compatible API"
        onClick={onBringKey}
      />
    </div>
  );
}

function SetupOption({
  icon: Icon,
  label,
  caption,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="h-auto items-start justify-start gap-2 whitespace-normal rounded-lg bg-secondary/40 px-2.5 py-2 text-left font-normal hover:border-primary/40 hover:bg-secondary [&_svg]:size-3.5"
    >
      <Icon className="mt-0.5 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{caption}</div>
      </div>
    </Button>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className="size-7"
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Strip raw HTML tokens from agent-authored markdown before rendering —
// agent replies aren't trusted content the way bundled docs markdown is
// (see /pages/docs.tsx's marked.use), so block/inline `html` nodes are
// dropped rather than passed through to dangerouslySetInnerHTML.
const chatRenderer = new marked.Renderer();
chatRenderer.html = () => "";
// Same trust boundary for links: a prompt-injected scene could steer the model
// into emitting a javascript:/data: href, and this origin's localStorage holds
// the user's API key. Non-http(s)/mailto links render as plain text.
chatRenderer.link = function (token) {
  return /^(https?:|mailto:)/i.test(token.href)
    ? marked.Renderer.prototype.link.call(this, token)
    : this.parser.parseInline(token.tokens);
};

function MessageBody({ text }: { text: string }) {
  const html = useMemo(
    () =>
      marked.parse(text, {
        gfm: true,
        breaks: true,
        renderer: chatRenderer,
      }) as string,
    [text],
  );
  return (
    <div
      className="chat-prose min-w-0 max-w-full break-words"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: agent markdown is rendered through a renderer that strips raw HTML nodes
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AgentAvatar({ large }: { large?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground",
        large ? "size-7" : "size-6",
      )}
    >
      <Sparkles className={large ? "size-4" : "size-3.5"} />
    </div>
  );
}

function ToolEventRows({
  events,
  divided,
}: {
  events: { label: string; ok: boolean }[];
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        divided && "mb-1.5 border-b border-border/60 pb-1.5",
      )}
    >
      {events.map((ev, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only log, index is stable
          key={i}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-[11px] leading-snug",
            ev.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          <span
            className={cn(
              "size-1 shrink-0 rounded-full",
              ev.ok ? "bg-muted-foreground/50" : "bg-destructive",
            )}
          />
          <span className="min-w-0 truncate" title={ev.label}>
            {ev.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// True until `ms` after `since`; re-renders once when the window lapses.
function useRecent(since: number | undefined, ms: number): boolean {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (since === undefined) return;
    const left = since + ms - Date.now();
    if (left <= 0) return;
    const t = setTimeout(rerender, left);
    return () => clearTimeout(t);
  }, [since, ms]);
  return since !== undefined && Date.now() - since < ms;
}

// The external agent's tool activity, with a working indicator shortly after
// its latest event.
function ToolLog({
  events,
  activeSince,
}: {
  events: OwnAgentEvent[];
  activeSince: number | undefined;
}) {
  const active = useRecent(activeSince, OWN_AGENT_ACTIVE_MS);
  return (
    <div className="flex w-full min-w-0 items-end gap-2">
      <AgentAvatar />
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-[13px] leading-relaxed text-secondary-foreground">
        <ToolEventRows events={events} />
        {active && (
          <div className="mt-1.5">
            <WorkingIndicator />
          </div>
        )}
      </div>
    </div>
  );
}

const Bubble = memo(function Bubble({
  message,
  onRevert,
  streaming,
}: {
  message: Message;
  onRevert: (id: number) => void;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  const toolEvents = message.toolEvents ?? [];
  const hasText = message.text.length > 0;
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "flex w-full min-w-0 items-end gap-2",
          isUser && "flex-row-reverse",
        )}
      >
        {!isUser && <AgentAvatar />}
        <div
          className={cn(
            "min-w-0 max-w-[85%] break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
            isUser
              ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-secondary text-secondary-foreground",
          )}
        >
          {toolEvents.length > 0 && (
            <ToolEventRows events={toolEvents} divided={hasText} />
          )}
          {isUser ? message.text : <MessageBody text={message.text} />}
          {streaming && (
            <div className={cn((hasText || toolEvents.length > 0) && "mt-1.5")}>
              <WorkingIndicator />
            </div>
          )}
        </div>
      </div>
      {!isUser && message.revertTo !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRevert(message.id)}
          className="ml-8 h-6 gap-1 px-1.5 text-[11px] [&_svg]:size-3"
        >
          <RotateCcw />
          Revert
        </Button>
      )}
    </div>
  );
});

function TypingBubble() {
  return (
    <div className="flex items-end gap-2">
      <AgentAvatar />
      <div className="flex items-center rounded-2xl rounded-bl-sm bg-secondary px-3 py-2.5">
        <WorkingIndicator />
      </div>
    </div>
  );
}

export default AgentChat;
