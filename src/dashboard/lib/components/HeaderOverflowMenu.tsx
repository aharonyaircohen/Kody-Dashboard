/**
 * @fileType component
 * @domain kody
 * @pattern header-overflow
 * @ai-summary Desktop "⋯" overflow menu that collects the dashboard's
 *   occasional header actions (Publish, Clean up branches, Refresh, Report a
 *   Kody bug) so the top bar stays to two visible controls (Notifications +
 *   this menu). Mirrors the items already in the mobile actions sheet.
 */
"use client";

import { useState } from "react";
import {
  GitBranch,
  LifeBuoy,
  MoreHorizontal,
  RefreshCw,
  Rocket,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import { cn } from "../utils";
import { usePublishRelease } from "../hooks/usePublishRelease";
import { ConfirmDialog } from "./ConfirmDialog";
import { SimpleTooltip } from "./SimpleTooltip";

interface HeaderOverflowMenuProps {
  actorLogin?: string;
  onPublished?: (issueNumber: number) => void;
  onOpenBranchCleanup: () => void;
  onReportBug: () => void;
  onRefresh: () => void;
  isFetching: boolean;
}

export function HeaderOverflowMenu({
  actorLogin,
  onPublished,
  onOpenBranchCleanup,
  onReportBug,
  onRefresh,
  isFetching,
}: HeaderOverflowMenuProps) {
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const { publish, pending } = usePublishRelease({ actorLogin, onPublished });

  return (
    <>
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
          <DropdownMenuItem
            onClick={() => setShowPublishConfirm(true)}
            disabled={pending}
          >
            <Rocket
              className={cn("w-4 h-4", pending && "animate-pulse")}
            />
            Publish a release
          </DropdownMenuItem>

          <DropdownMenuItem onClick={onOpenBranchCleanup}>
            <GitBranch className="w-4 h-4" />
            Clean up branches
          </DropdownMenuItem>

          <DropdownMenuItem onClick={onRefresh} disabled={isFetching}>
            <RefreshCw
              className={cn("w-4 h-4", isFetching && "animate-spin")}
            />
            Refresh
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={onReportBug}>
            <LifeBuoy className="w-4 h-4" />
            Report a Kody bug
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={showPublishConfirm}
        title="Publish a release?"
        description="This creates a release-request task and triggers @kody release. The orchestrator runs prepare → merge PR → publish → deploy."
        confirmLabel="Publish"
        variant="default"
        onConfirm={publish}
        onClose={() => setShowPublishConfirm(false)}
      />
    </>
  );
}
