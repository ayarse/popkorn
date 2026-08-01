import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OwnAgentStatus } from "@/hooks/use-own-agent";
import { cn } from "@/lib/utils";

function CommandRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-start gap-1.5">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
          {command}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          aria-label={`Copy ${label} command`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

const STATUS_COPY: Record<OwnAgentStatus, string> = {
  idle: "Not connected",
  waiting: "Waiting for your agent…",
  connected: "Agent connected",
  disconnected: "Disconnected — reconnect to keep editing",
};

export function ConnectAgent({
  status,
  mcpUrl,
  clientName,
  onConnect,
  onDisconnect,
  onRotate,
  onClose,
}: {
  status: OwnAgentStatus;
  mcpUrl: string | null;
  clientName: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRotate: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Use your own agent</DialogTitle>
          <DialogDescription>
            Connect Claude Code, Codex, or any MCP client and edit this scene
            from your terminal. The link below is this tab's private session —
            anyone with it can edit the scene while the tab stays open. It stays
            valid for this browser until you generate a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px]">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                status === "connected" && "bg-primary",
                status === "waiting" && "animate-pulse bg-muted-foreground",
                (status === "idle" || status === "disconnected") && "bg-border",
              )}
            />
            <span className="text-muted-foreground">
              {clientName && status === "connected"
                ? `${clientName} connected`
                : STATUS_COPY[status]}
            </span>
            {(status === "idle" || status === "disconnected") && (
              <Button size="sm" className="ml-auto" onClick={onConnect}>
                Connect
              </Button>
            )}
            {(status === "waiting" || status === "connected") && (
              <div className="ml-auto flex items-center gap-1.5">
                {mcpUrl && (
                  <Button variant="ghost" size="sm" onClick={onRotate}>
                    New link
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onDisconnect}>
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {mcpUrl && status !== "idle" && (
            <>
              <CommandRow
                label="Claude Code"
                command={`claude mcp add --transport http popkorn ${mcpUrl}`}
              />
              <CommandRow
                label="Codex"
                command={`codex mcp add popkorn --url ${mcpUrl}`}
              />
              <CommandRow
                label="Any MCP client (streamable HTTP)"
                command={mcpUrl}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
