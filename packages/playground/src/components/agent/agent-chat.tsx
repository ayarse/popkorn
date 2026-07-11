import {
  AlertCircle,
  LoaderCircle,
  type LucideIcon,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSettings } from "@/components/agent/agent-settings";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { type Message, SUGGESTIONS } from "@/lib/agent";
import { cn } from "@/lib/utils";

export type AgentChatProps = {
  open: boolean;
  onClose: () => void;
  source: string;
  onApplySource: (css: string) => void;
};

function AgentChat({ open, onClose, source, onApplySource }: AgentChatProps) {
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
    <aside className="flex w-[384px] shrink-0 flex-col border-l border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-right-2">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
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
          <Bubble key={m.id} message={m} onRevert={revert} />
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
    </aside>
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
    <div className="flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
      <span className="size-1 shrink-0 animate-pulse rounded-full bg-muted-foreground/50" />
      <span>{verb}…</span>
    </div>
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

function Bubble({
  message,
  onRevert,
}: {
  message: Message;
  onRevert: (id: number) => void;
}) {
  const isUser = message.role === "user";
  const toolEvents = message.toolEvents ?? [];
  const hasText = message.text.length > 0;
  // Quiet indicator while reasoning streams and nothing else has landed yet.
  const thinking = message.reasoning && !hasText && toolEvents.length === 0;
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
                    "flex items-center gap-1.5 text-[11px] leading-snug",
                    ev.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  <span
                    className={cn(
                      "size-1 shrink-0 rounded-full",
                      ev.ok ? "bg-muted-foreground/50" : "bg-destructive",
                    )}
                  />
                  <span className="truncate">{ev.label}</span>
                </div>
              ))}
            </div>
          )}
          {thinking && <WorkingIndicator />}
          {isUser ? message.text : <MessageBody text={message.text} />}
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
