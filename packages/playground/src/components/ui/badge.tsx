import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium transition-colors",
  {
    variants: {
      variant: {
        secondary: "bg-muted text-foreground",
        outline: "border border-border bg-secondary/40 text-muted-foreground",
        warning: "bg-amber-500/15 text-amber-500",
        destructive: "bg-destructive/15 text-destructive",
        glass:
          "border border-border/60 bg-background/80 text-foreground backdrop-blur-md",
      },
      shape: {
        pill: "rounded-full px-2.5 py-0.5 text-[11px]",
        count: "rounded-sm px-1 text-[10px] font-semibold tabular-nums",
        tag: "rounded-md px-2.5 py-1.5 text-xs",
      },
    },
    defaultVariants: { variant: "secondary", shape: "pill" },
  },
);

function Badge({
  className,
  variant,
  shape,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant, shape }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
