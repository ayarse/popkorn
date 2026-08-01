import { useNavigate } from "@tanstack/react-router";
import { Loader2, Save, Tag as TagIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CommunityScene } from "@/hooks/use-scene";
import { deleteScene, updateScene } from "@/lib/scenes";

/** Save/retag/delete for a scene you published, in the player toolbar beside
 *  the other things you do to a scene. Every write re-checks ownership
 *  server-side; this only decides what's worth showing. Mount it keyed on the
 *  scene id — the tag draft is seeded once. */
export function OwnerActions({
  community,
  source,
}: {
  community: CommunityScene;
  source: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [armed, setArmed] = useState(false);
  const [tags, setTags] = useState(community.tags);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <TagIcon className="size-3.5" />
            {tags.length
              ? `${tags.length} tag${tags.length > 1 ? "s" : ""}`
              : "Tags"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <TagInput
            autoFocus
            tags={tags}
            onChange={(next) => {
              setTags(next);
              setState("idle"); // edited tags are unsaved again
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          void updateScene({
            data: { id: community.id, css: source, tags: tags.join(" ") },
          })
            .then(() => setState("saved"))
            .catch(() => setState("idle"));
        }}
      >
        {state === "busy" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        {state === "saved" ? "Saved" : "Save changes"}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={armed ? "destructive" : "ghost"}
            size={armed ? "sm" : "icon"}
            aria-label="Delete this scene"
            onBlur={() => setArmed(false)}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              void deleteScene({ data: community.id }).then(() =>
                navigate({ to: "/community" }),
              );
            }}
          >
            <Trash2 className="size-4" />
            {armed && <span className="ml-1.5">Delete?</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete this scene</TooltipContent>
      </Tooltip>
    </>
  );
}
