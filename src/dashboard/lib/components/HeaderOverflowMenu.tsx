/**
 * @fileType component
 * @domain kody
 * @pattern header-overflow
 * @ai-summary Desktop "⋯" overflow menu that collects the dashboard's
 *   occasional header actions (Refresh, Report a Kody bug) so the top bar
 *   stays to two visible controls (Notifications + this menu). Publish /
 *   Clean up branches moved to the Jobs page (.kody/jobs/*.md).
 */
"use client";

import { LifeBuoy, MoreHorizontal, RefreshCw } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import { cn } from "../utils";
import { SimpleTooltip } from "./SimpleTooltip";

interface HeaderOverflowMenuProps {
  onReportBug: () => void;
  onRefresh: () => void;
  isFetching: boolean;
}

export function HeaderOverflowMenu({
  onReportBug,
  onRefresh,
  isFetching,
}: HeaderOverflowMenuProps) {
  return (
    <DropdownMenu>
      <SimpleTooltip content="More actions" side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="More actions"
            className="gap-1"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
      </SimpleTooltip>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onRefresh} disabled={isFetching}>
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          Refresh
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onReportBug}>
          <LifeBuoy className="w-4 h-4" />
          Report a Kody bug
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
