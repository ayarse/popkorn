import {
  AlertCircle,
  Brain,
  LoaderCircle,
  type LucideIcon,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentSettings } from "@/components/agent/agent-settings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentChat } from "@/hooks/use-agent-chat";
import {
  type AgentConfig,
  type Message,
  type ReasoningEffort,
  SUGGESTIONS,
} from "@/lib/agent";
import { cn } from "@/lib/utils";

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
    send,
    revert,
  } = useAgentChat(source, onApplySource);

  // Set the reasoning mode without touching the rest of the config (persists
  // through the same saveConfig round trip as the settings dialog). undefined
  // = model default, so the key is dropped rather than stored.
  const setReasoning = useCallback(
    (r: ReasoningEffort | undefined) => {
      if (!config) return;
      const next: AgentConfig = { ...config };
      if (r) next.reasoning = r;
      else delete next.reasoning;
      applyConfig(next);
    },
    [config, applyConfig],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

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
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">
              Popkorn Copilot
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
            <Bubble
              key={m.id}
              message={m}
              onRevert={revert}
              streaming={typing && streamingId === m.id}
            />
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
              {SUGGESTIONS.map((s) => (
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
          <ReasoningControl
            value={config?.reasoning}
            onChange={setReasoning}
            disabled={!config}
          />
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
          <AgentSettings
            current={config}
            onSave={applyConfig}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// Claude Code-style whimsical working verbs, shown while a run is waiting on
// the model (reasoning streaming, or just slow first-token latency).
const WORKING_VERBS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Beaming",
  "Beboppin'",
  "Befuddling",
  "Billowing",
  "Blanching",
  "Bloviating",
  "Boogieing",
  "Boondoggling",
  "Booping",
  "Bootstrapping",
  "Brewing",
  "Bunning",
  "Burrowing",
  "Calculating",
  "Canoodling",
  "Caramelizing",
  "Cascading",
  "Catapulting",
  "Cerebrating",
  "Channeling",
  "Channelling",
  "Choreographing",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Composing",
  "Computing",
  "Concocting",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Cultivating",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Dilly-dallying",
  "Discombobulating",
  "Doing",
  "Doodling",
  "Drizzling",
  "Ebbing",
  "Effecting",
  "Elucidating",
  "Embellishing",
  "Enchanting",
  "Envisioning",
  "Evaporating",
  "Fermenting",
  "Fiddle-faddling",
  "Finagling",
  "Flambéing",
  "Flibbertigibbeting",
  "Flowing",
  "Flummoxing",
  "Fluttering",
  "Forging",
  "Forming",
  "Frolicking",
  "Frosting",
  "Gallivanting",
  "Galloping",
  "Garnishing",
  "Generating",
  "Gesticulating",
  "Germinating",
  "Gitifying",
  "Grooving",
  "Gusting",
  "Harmonizing",
  "Hashing",
  "Hatching",
  "Herding",
  "Honking",
  "Hullaballooing",
  "Hyperspacing",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Infusing",
  "Ionizing",
  "Jitterbugging",
  "Levitating",
  "Lollygagging",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Metamorphosing",
  "Misting",
  "Moonwalking",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Nebulizing",
  "Nesting",
  "Newspapering",
  "Noodling",
  "Nucleating",
  "Orbiting",
  "Orchestrating",
  "Osmosing",
  "Perambulating",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Photosynthesizing",
  "Pollinating",
  "Pondering",
  "Pontificating",
  "Pouncing",
  "Precipitating",
  "Prestidigitating",
  "Processing",
  "Proofing",
  "Propagating",
  "Puttering",
  "Puzzling",
  "Quantumizing",
  "Razzle-dazzling",
  "Razzmatazzing",
  "Recombobulating",
  "Reticulating",
  "Roosting",
  "Ruminating",
  "Sautéing",
  "Scampering",
  "Schlepping",
  "Scurrying",
  "Sketching",
  "Slithering",
  "Smooshing",
  "Sock-hopping",
  "Spelunking",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Sublimating",
  "Swirling",
  "Swooping",
  "Symbioting",
  "Synthesizing",
  "Tempering",
  "Thinking",
  "Thundering",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Transfiguring",
  "Transmuting",
  "Twisting",
  "Undulating",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Waddling",
  "Wandering",
  "Warping",
  "Whatchamacalliting",
  "Whirlpooling",
  "Whirring",
  "Whisking",
  "Wibbling",
  "Working",
  "Wrangling",
  "Zesting",
  "Zigzagging",
];

const randomVerb = () =>
  WORKING_VERBS[Math.floor(Math.random() * WORKING_VERBS.length)];

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

const REASONING_MODES: { value: string; label: string }[] = [
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
  onChange: (r: ReasoningEffort | undefined) => void;
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
              className={cn("size-9 shrink-0", value && "text-primary")}
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
          onValueChange={(v) =>
            onChange(v === "default" ? undefined : (v as ReasoningEffort))
          }
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

function Bubble({
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
        {!isUser && (
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
        )}
        <div
          className={cn(
            "min-w-0 max-w-[85%] break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
            isUser
              ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-secondary text-secondary-foreground",
          )}
        >
          {toolEvents.length > 0 && (
            <div
              className={cn(
                "flex flex-col gap-0.5",
                hasText && "mb-1.5 border-b border-border/60 pb-1.5",
              )}
            >
              {toolEvents.map((ev, i) => (
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
        <button
          type="button"
          onClick={() => onRevert(message.id)}
          className="ml-8 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          <span>Revert</span>
        </button>
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
      <div className="flex items-center rounded-2xl rounded-bl-sm bg-secondary px-3 py-2.5">
        <WorkingIndicator />
      </div>
    </div>
  );
}

export default AgentChat;
