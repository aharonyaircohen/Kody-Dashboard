import { cn } from "@dashboard/lib/utils/ui";
import * as React from "react";

const Textarea: React.FC<
  {
    ref?: React.Ref<HTMLTextAreaElement>;
  } & React.TextareaHTMLAttributes<HTMLTextAreaElement>
> = ({ className, ref, ...props }) => {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-form-border bg-form px-3.5 py-2.5 text-body-sm ring-offset-background placeholder:text-form-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};

export { Textarea };
