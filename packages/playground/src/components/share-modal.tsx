import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import { MAX_CSS_BYTES, submitScene } from "@/lib/scenes";

/** Publishes `source` when the playground opens it; with no `source` (the
 *  community page's CTA) it takes pasted Popkorn CSS instead. */
export function ShareModal({
  source,
  onClose,
}: {
  source?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const css = source ?? pasted;
  const tooBig = new TextEncoder().encode(css).length > MAX_CSS_BYTES;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await submitScene({
        data: { title, css, tags: tags.join(" ") },
      });
      track("scene_share");
      // The share page is where the link, the report button and the byline
      // live — landing on it beats handing back a URL to copy.
      await navigate({ to: "/s/$id", params: { id } });
    } catch (e: any) {
      setError(e.message ?? "Could not publish that scene.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish to the community</DialogTitle>
          <DialogDescription>
            {source === undefined
              ? "Paste an animation to post it to the community gallery. You can edit or delete it later."
              : "Shares the animation you're working on to the community gallery. You can edit or delete it later."}
          </DialogDescription>
        </DialogHeader>

        <Show
          when="signed-in"
          fallback={
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Publishing needs an account, so scenes carry a byline.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <SignInButton mode="modal">
                  <Button size="sm">Sign in to publish</Button>
                </SignInButton>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Title"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <TagInput tags={tags} onChange={setTags} />
            {source === undefined && (
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Paste your Popkorn CSS here"
                spellCheck={false}
                className="h-48 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            {(error || tooBig) && (
              <p className="text-xs text-destructive">
                {tooBig ? "Scene is too large to share (100KB max)." : error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || tooBig || !title.trim() || !css.trim()}
                onClick={() => void submit()}
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Publish
              </Button>
            </div>
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  );
}
