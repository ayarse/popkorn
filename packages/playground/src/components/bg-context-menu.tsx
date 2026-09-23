import { Check } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const PLAYER_BACKGROUNDS = [
  { name: "Transparent", value: "transparent", swatch: "transparent" },
  { name: "White", value: "#ffffff", swatch: "#ffffff" },
  { name: "Paper", value: "#f4f4f5", swatch: "#f4f4f5" },
  { name: "Graphite", value: "#1f1f2e", swatch: "#1f1f2e" },
  { name: "Ink", value: "#0a0a12", swatch: "#0a0a12" },
  { name: "Crimson", value: "#5e1020", swatch: "#5e1020" },
  { name: "Forest", value: "#11241a", swatch: "#11241a" },
  { name: "Cobalt", value: "#1a1f4d", swatch: "#1a1f4d" },
];

type PlayerBackground = (typeof PLAYER_BACKGROUNDS)[number];

/** Round color dot; transparent renders as a struck-through circle. */
export function BgSwatch({
  bg,
  className,
}: {
  bg: PlayerBackground;
  className?: string;
}) {
  return (
    <span
      className={cn("shrink-0 rounded-full border", className)}
      style={
        bg.value === "transparent"
          ? {
              backgroundImage:
                "linear-gradient(135deg, transparent 47%, #888 47%, #888 53%, transparent 53%)",
              backgroundColor: "var(--background)",
            }
          : { backgroundColor: bg.swatch }
      }
    />
  );
}

/** Two-column background picker, shared by the toolbar popover and the menu. */
export function BgSwatchGrid({
  bgIndex,
  onSelect,
  showCheck = false,
}: {
  bgIndex: number;
  onSelect: (i: number) => void;
  showCheck?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {PLAYER_BACKGROUNDS.map((bg, i) => (
        <button
          type="button"
          key={bg.name}
          onClick={() => onSelect(i)}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60",
            bgIndex === i && "bg-secondary/60",
          )}
        >
          <BgSwatch bg={bg} className="size-3.5 border-border/40" />
          <span className="truncate">{bg.name}</span>
          {showCheck && bgIndex === i && (
            <Check className="ml-auto size-3.5 text-foreground" />
          )}
        </button>
      ))}
    </div>
  );
}

/** Right-click background menu, anchored at the pointer; Radix handles
 *  collision clamping, dismissal and focus. */
export function BgContextMenu({
  position,
  onClose,
  bgIndex,
  onSelect,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  bgIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          className="pointer-events-none fixed size-0"
          style={{ left: position.x, top: position.y }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={4}
        className="w-auto min-w-[12rem] p-1.5"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Background color
        </div>
        <BgSwatchGrid
          bgIndex={bgIndex}
          showCheck
          onSelect={(i) => {
            onSelect(i);
            onClose();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
