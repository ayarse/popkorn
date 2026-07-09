import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import popcornIconRaw from "../assets/popcorn-icon.svg?raw";

type BrandMarkProps = {
  suffix?: React.ReactNode;
  className?: string;
};

export function BrandMark({ suffix, className }: BrandMarkProps) {
  return (
    <Link to="/" className={cn("flex items-center gap-2 pr-2", className)}>
      <div className="flex size-5 items-center justify-center rounded-md bg-indigo-500 text-white">
        <span
          // biome-ignore lint/security/noDangerouslySetInnerHtml: bundled trusted SVG icon
          dangerouslySetInnerHTML={{ __html: popcornIconRaw }}
          className="[&>svg]:size-3 [&>svg]:fill-current"
        />
      </div>
      <h1 className="text-[15px] font-semibold tracking-tight">Popcorn</h1>
      {suffix}
    </Link>
  );
}
