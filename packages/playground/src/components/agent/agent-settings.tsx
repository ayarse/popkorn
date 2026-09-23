import { Check, ChevronDown, Eye, EyeOff, Sparkles } from "lucide-react";
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
    <Popover open={open} onOpenChange={setOpenAndReset}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between rounded-lg bg-background px-3 font-mono text-[13px] font-normal"
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
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)]"
      >
        <Command shouldFilter={false} className="rounded-lg">
          <CommandInput
            placeholder="Search or type a model id…"
            value={search}
            onValueChange={setSearch}
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
      </PopoverContent>
    </Popover>
  );
}

const FIELD = "h-9 flex-1 rounded-lg py-0 font-mono text-[13px]";

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
      <span className={labelClass}>{label}</span>
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
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-…"
                spellCheck={false}
                className={FIELD}
              />
              <Button
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

          <Field label="Base URL">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
              placeholder={DEFAULT_BASE_URL}
              className={FIELD}
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
                reasoning: current?.reasoning ?? "default",
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
