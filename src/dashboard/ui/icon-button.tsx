"use client";

import * as React from "react";

import { Button, type ButtonProps } from "@dashboard/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@dashboard/ui/tooltip";
import { cn } from "@dashboard/lib/utils/ui";

interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  icon: React.ReactNode;
  label: string;
  size?: "sm" | "default";
  tooltip?: string;
}

const SIZE_CLASS: Record<NonNullable<IconButtonProps["size"]>, string> = {
  default: "h-11 w-11",
  sm: "h-10 w-10",
};

export function IconButton({
  icon,
  label,
  tooltip,
  size = "default",
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      aria-label={label}
      className={cn(SIZE_CLASS[size], "px-0", className)}
      size="clear"
      {...props}
    >
      {icon}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
