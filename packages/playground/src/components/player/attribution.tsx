import { Info } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";

/** Icon-sized credit pill that expands to the author name on hover/focus.
 * On mobile (no hover) the first tap expands it; only the second follows the
 * link, so a stray tap doesn't yank the user off the page. */
export function Attribution({
  author,
  url,
  className,
}: {
  author: string;
  url?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const Tag: any = url ? "a" : "div";
  return (
    <Tag
      {...(url ? { href: url, target: "_blank", rel: "noreferrer" } : {})}
      title={author}
      onClick={(e: React.MouseEvent) => {
        if (isMobile && !expanded) {
          e.preventDefault();
          setExpanded(true);
        }
      }}
      onBlur={() => setExpanded(false)}
      className={cn(
        "group flex items-center rounded-full border border-border/40 bg-background/50 px-1.5 py-1 text-[10px] text-muted-foreground backdrop-blur-md transition-colors hover:bg-background/85 hover:text-foreground",
        expanded && "bg-background/85 text-foreground",
        className,
      )}
    >
      <Info className="size-3 shrink-0" />
      <span
        className={cn(
          "max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-[220px] group-hover:pl-1.5",
          expanded && "max-w-[220px] pl-1.5",
        )}
      >
        {author}
      </span>
    </Tag>
  );
}
