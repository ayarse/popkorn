import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ImportModal({
  onFile,
  onText,
  onClose,
}: {
  onFile: (file: File) => void;
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Drop a bodymovin <code className="font-mono">.json</code> or an{" "}
            <code className="font-mono">.svg</code> file, or paste Lottie JSON
            or SVG markup. It will be converted to Popkorn. Need a file?{" "}
            <a
              href="https://github.com/ayarse/popkorn/tree/main/examples/lottie"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Grab an example Lottie
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className={cn(
            "w-full cursor-pointer rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors",
            dragOver
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
          )}
        >
          Drop a <code className="font-mono">.json</code> or{" "}
          <code className="font-mono">.svg</code> file here, or click to browse
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,.svg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or paste source
          <div className="h-px flex-1 bg-border" />
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "v": "5.7.0", "layers": [ ... ] }  or  <svg ...>'
          aria-label="Lottie JSON or SVG markup"
          spellCheck={false}
          className="h-36"
        />

        <div className="flex justify-end">
          <Button onClick={() => onText(text)}>Import</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
