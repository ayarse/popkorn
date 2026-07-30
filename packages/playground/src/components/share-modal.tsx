import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/**
 * Turnstile widget. Loads the script on first render and renders into a div.
 * With no site key configured the widget is skipped entirely and the server
 * skips verification to match.
 */
function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const el = ref.current;
    const render = () => {
      const ts = (window as any).turnstile;
      if (ts && el.childElementCount === 0)
        ts.render(el, { sitekey: SITE_KEY, callback: onToken });
    };
    if ((window as any).turnstile) {
      render();
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [onToken]);

  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}

export function ShareModal({
  source,
  onClose,
}: {
  source: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tooBig = new TextEncoder().encode(source).length > MAX_CSS_BYTES;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await submitScene({ data: { title, css: source, token } });
      track("scene_share");
      setUrl(`${window.location.origin}/s/${id}`);
    } catch (e: any) {
      setError(e.message ?? "Could not publish that scene.");
    } finally {
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
            Posts the editor's CSS to the public community page and gives you a
            link to it. There's no account, and no way to edit or delete it
            afterwards.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            />
            <Button
              size="icon"
              variant="secondary"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Title"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Turnstile onToken={setToken} />
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
        )}
      </DialogContent>
    </Dialog>
  );
}
