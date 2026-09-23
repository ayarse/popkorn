import type * as React from "react";
import { cn } from "@/lib/utils";

const labelClass =
  "block text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or nest the control
  return <label className={cn(labelClass, className)} {...props} />;
}

export { Label, labelClass };
