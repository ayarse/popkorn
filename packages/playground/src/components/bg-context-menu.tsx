import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    const onBlur = () =>
      window.addEventListener("focus", onClose, { once: true });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  // Position the menu, clamping to the viewport so it never overflows.
  const [pos, setPos] = useState(position);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - 4)
      x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight - 4)
      y = window.innerHeight - rect.height - 4;
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [position]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-foreground shadow-xl shadow-black/40 animate-in fade-in-0 zoom-in-95"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        Background color
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        {PLAYER_BACKGROUNDS.map((bg, i) => (
          <button
            type="button"
            key={bg.name}
            onClick={() => {
              onSelect(i);
              onClose();
            }}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60",
              bgIndex === i && "bg-secondary/60",
            )}
          >
            <span
              className="size-3.5 shrink-0 rounded-full border border-border/40"
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
            <span className="truncate">{bg.name}</span>
            {bgIndex === i && (
              <Check className="ml-auto size-3.5 text-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
