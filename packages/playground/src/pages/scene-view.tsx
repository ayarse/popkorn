import { Flag, Pencil } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { MotionCanvas } from "@/components/motion-canvas";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportScene } from "@/lib/scenes";
import { cn } from "@/lib/utils";

export function SceneView({
  id,
  title,
  css,
}: {
  id: string;
  title: string;
  css: string;
}) {
  const [reported, setReported] = useState(false);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <BrandMark />
        <span className="truncate text-[15px] text-muted-foreground/70">
          / {title}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* Full page load: the playground is a separate client-only shell. */}
          <a
            href={`/?scene=${id}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "gap-1.5",
            )}
          >
            <Pencil className="size-3.5" />
            Open in playground
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={reported}
            onClick={() => {
              setReported(true);
              void reportScene({ data: id });
            }}
          >
            <Flag className="size-3.5" />
            {reported ? "Reported" : "Report"}
          </Button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden p-4">
        {/* The player sizes itself to 100% width but takes its height from the
            box it's in — give it an explicit one or the scene overflows. */}
        <MotionCanvas source={css} style={{ height: "100%" }} />
      </main>
    </div>
  );
}
