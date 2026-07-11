import { Check, ChevronDown, Eye, EyeOff, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import {
  type AgentConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_PRESETS,
} from "@/lib/agent";
import { cn } from "@/lib/utils";

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

export function AgentSettings({
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
                // Preserve any reasoning mode set from the composer control.
                ...(current?.reasoning ? { reasoning: current.reasoning } : {}),
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
