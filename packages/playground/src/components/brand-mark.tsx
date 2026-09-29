import { Link } from "@tanstack/react-router";
import popkornIcon from "@/assets/popkorn-icon.svg?url";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  suffix?: React.ReactNode;
  className?: string;
};

export function BrandMark({ suffix, className }: BrandMarkProps) {
  return (
    <Link
      to="/"
      className={cn(
        "flex shrink-0 items-center gap-2 whitespace-nowrap pr-2",
        className,
      )}
    >
      <img src={popkornIcon} alt="" className="size-7 shrink-0" />
      <h1 className="text-[15px] font-semibold tracking-tight">Popkorn</h1>
      {suffix}
    </Link>
  );
}
