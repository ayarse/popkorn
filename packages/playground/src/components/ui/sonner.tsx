import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "calc(var(--radius) - 2px)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans text-[13px] shadow-xl",
          description: "!text-muted-foreground",
          error: "[&_[data-icon]]:text-destructive",
          warning: "[&_[data-icon]]:text-amber-500",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
