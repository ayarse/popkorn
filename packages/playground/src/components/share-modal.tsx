import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
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

export function ShareModal({
  source,
  onClose,
}: {
  source: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooBig = new TextEncoder().encode(source).length > MAX_CSS_BYTES;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await submitScene({ data: { title, css: source } });
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
            Posts the editor's CSS to the public community page under your name.
            There's no way to edit or delete it afterwards.
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
                disabled={busy || tooBig || !title.trim()}
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
