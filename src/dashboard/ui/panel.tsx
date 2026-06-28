import * as React from "react";

import { cn } from "@dashboard/lib/utils/ui";

const Panel: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <section
    ref={ref}
    className={cn(
      "rounded-lg border border-border bg-card text-card-foreground shadow-elevation-1",
      className,
    )}
    {...props}
  />
);

const PanelHeader: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-2 p-card-padding", className)}
    {...props}
  />
);

const PanelTitle: React.FC<
  {
    ref?: React.Ref<HTMLHeadingElement>;
  } & React.HTMLAttributes<HTMLHeadingElement>
> = ({ className, ref, ...props }) => (
  <h2
    ref={ref}
    className={cn("text-heading-lg font-semibold leading-tight", className)}
    {...props}
  />
);

const PanelDescription: React.FC<
  {
    ref?: React.Ref<HTMLParagraphElement>;
  } & React.HTMLAttributes<HTMLParagraphElement>
> = ({ className, ref, ...props }) => (
  <p
    ref={ref}
    className={cn("text-body-sm text-muted-foreground", className)}
    {...props}
  />
);

const PanelContent: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div ref={ref} className={cn("p-card-padding pt-0", className)} {...props} />
);

const PanelFooter: React.FC<
  { ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>
> = ({ className, ref, ...props }) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-wrap items-center justify-end gap-3 border-t border-border px-card-padding py-card-padding-sm",
      className,
    )}
    {...props}
  />
);

export {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
};
