import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { labelClass } from "@/components/ui/label";
import type { OwnAgentStatus } from "@/hooks/use-own-agent";
import { cn } from "@/lib/utils";

function CommandRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{label}</span>
      <div className="flex items-start gap-1.5">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
          {command}
        </code>
        <Button
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${label} command`}
          className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="text-primary" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

const STATUS_COPY: Record<OwnAgentStatus, string> = {
  idle: "Not connected",
  waiting: "Waiting for your agent…",
  connected: "Agent connected",
  disconnected: "Disconnected. Reconnect to keep editing.",
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
            from your terminal. The link below is this tab's private session.
            Anyone with it can edit the scene while the tab stays open. It stays
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
                command={`claude mcp add --scope user --transport http popkorn ${mcpUrl}`}
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
