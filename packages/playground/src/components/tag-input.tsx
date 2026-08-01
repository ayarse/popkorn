import { X } from "lucide-react";
import { useState } from "react";
import { MAX_TAGS, parseTags } from "@/lib/scenes";

/** Chip editor for a scene's tags — the field holds the chips, so what you see
 *  is what gets stored. Typed, pasted and blurred text all go through
 *  `parseTags`, the same slug rules the server applies on write. */
export function TagInput({
  tags,
  onChange,
  autoFocus,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = tags.length >= MAX_TAGS;

  function commit(raw: string) {
    setDraft("");
    const next = [...new Set([...tags, ...parseTags(raw)])].slice(0, MAX_TAGS);
    if (next.length !== tags.length) onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">Tags</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {tags.length}/{MAX_TAGS}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-xs text-foreground"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {!full && (
          <input
            // biome-ignore lint/a11y/noAutofocus: opt-in, for the tag popover
            autoFocus={autoFocus}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Backspace" && !draft && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
            maxLength={30}
            placeholder={tags.length ? "" : "loader, retro, text"}
            className="min-w-[8ch] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {full
          ? "That's the limit. Remove one to add another."
          : "Enter or comma adds a tag."}
      </p>
    </div>
  );
}
