import * as React from "react";

import { Label } from "@dashboard/ui/label";
import { cn } from "@dashboard/lib/utils/ui";

interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2.5", className)} {...props}>
      {label && (
        <Label htmlFor={htmlFor} className="text-foreground">
          {label}
        </Label>
      )}
      {children}
      {(hint || error) && (
        <p
          className={cn(
            "text-body-xs leading-relaxed",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
