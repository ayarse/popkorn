import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { labelClass } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type AgentConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_PRESETS,
} from "@/lib/agent";
import { cn } from "@/lib/utils";

function ModelCombobox({
  id,
  value,
  onChange,
  presets,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  presets: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const exact = presets.some((p) => p === trimmed);
  const filtered = trimmed
    ? presets.filter((p) => p.toLowerCase().includes(lower))
    : presets;
  const showCustom = trimmed.length > 0 && !exact;

  const setOpenAndReset = (o: boolean) => {
    setOpen(o);
    if (!o) setSearch("");
  };
  const pick = (v: string) => {
    onChange(v);
    setOpenAndReset(false);
  };

  return (
    // modal: the portaled list sits outside the Dialog, whose scroll lock would eat its wheel events
    <Popover modal open={open} onOpenChange={setOpenAndReset}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between rounded-lg bg-background px-3 font-mono text-[13px] font-normal"
        >
          {value ? (
            <ModelLabel id={value} />
          ) : (
            <span className="text-muted-foreground">Choose a model</span>
          )}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 opacity-60 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden"
      >
        <Command shouldFilter={false} className="rounded-lg">
          <CommandInput
            placeholder="Search, or paste any model id…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 && !showCustom && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No matches.
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
                  <ModelLabel id={p} />
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
      </PopoverContent>
    </Popover>
  );
}

// Dims the provider prefix so the model name reads first.
function ModelLabel({ id }: { id: string }) {
  const slash = id.indexOf("/");
  return (
    <span className="truncate">
      {slash > 0 && (
        <span className="text-muted-foreground">{id.slice(0, slash + 1)}</span>
      )}
      {id.slice(slash + 1)}
    </span>
  );
}

const FIELD = "h-9 flex-1 rounded-lg py-0 font-mono text-[13px]";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
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
  const isOpenRouter =
    (baseUrl.trim() || DEFAULT_BASE_URL) === DEFAULT_BASE_URL;
  const canSave = apiKey.trim().length > 0 && model.trim().length > 0;

  const save = () =>
    onSave({
      baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
      apiKey: apiKey.trim(),
      model,
      reasoning: current?.reasoning ?? "default",
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-md gap-6 rounded-xl">
        <DialogHeader>
          <DialogTitle>Copilot settings</DialogTitle>
          <DialogDescription>
            Copilot runs on your own API key. It works with OpenRouter out of
            the box, or any OpenAI-compatible endpoint.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save();
          }}
        >
          <Field
            label="API key"
            htmlFor="copilot-key"
            hint={
              isOpenRouter ? (
                <>
                  Stays in this browser.{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                  >
                    Get an OpenRouter key
                    <ExternalLink className="size-3" />
                  </a>
                </>
              ) : (
                "Stays in this browser and is only sent to the endpoint below."
              )
            }
          >
            <div className="flex items-center gap-1.5">
              <Input
                id="copilot-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isOpenRouter ? "sk-or-v1-…" : "sk-…"}
                autoComplete="off"
                spellCheck={false}
                autoFocus={!apiKey}
                className={FIELD}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
                aria-pressed={showKey}
                className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </Field>

          <Field
            label="Model"
            htmlFor="copilot-model"
            hint="Pick a preset, or paste any model id your endpoint serves."
          >
            <ModelCombobox
              id="copilot-model"
              value={model}
              onChange={setModel}
              presets={MODEL_PRESETS}
            />
          </Field>

          <Field
            label="Endpoint"
            htmlFor="copilot-url"
            hint="Base URL of an OpenAI-compatible chat completions API."
          >
            <Input
              id="copilot-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
              placeholder={DEFAULT_BASE_URL}
              className={FIELD}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
