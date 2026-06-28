import * as React from "react";

import { cn } from "@dashboard/lib/utils/ui";

const Toolbar: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div
    ref={ref}
    className={cn(
      "flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 px-2.5 py-2",
      className,
    )}
    {...props}
  />
);

const ToolbarGroup: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div
    ref={ref}
    className={cn("flex min-w-0 items-center gap-2", className)}
    {...props}
  />
);

const ToolbarSeparator: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div
    ref={ref}
    className={cn("mx-1 h-6 w-px shrink-0 bg-border", className)}
    aria-hidden="true"
    {...props}
  />
);

export { Toolbar, ToolbarGroup, ToolbarSeparator };
