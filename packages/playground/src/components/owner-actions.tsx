import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Loader2,
  Save,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";

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
  const [state, setState] = useState<"idle" | "busy" | "saved" | "failed">(
    "idle",
  );
  const [armed, setArmed] = useState(false);
  const fail = (what: string) => (e: unknown) =>
    toast.error(what, {
      description: e instanceof Error ? e.message : String(e),
    });
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
        className={cn("gap-1.5", state === "failed" && "text-destructive")}
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          updateScene({
            data: { id: community.id, css: source, tags: tags.join(" ") },
          })
            .then(() => setState("saved"))
            .catch((e) => {
              setState("failed");
              fail("Couldn't save the scene")(e);
            });
        }}
      >
        {state === "busy" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : state === "failed" ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <Save className="size-3.5" />
        )}
        {state === "saved"
          ? "Saved"
          : state === "failed"
            ? "Retry save"
            : "Save changes"}
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
              setArmed(false);
              deleteScene({ data: community.id })
                .then(() => navigate({ to: "/community" }))
                .catch(fail("Couldn't delete the scene"));
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
