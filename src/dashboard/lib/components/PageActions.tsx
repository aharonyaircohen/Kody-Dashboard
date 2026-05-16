/**
 * @fileType component
 * @domain kody
 * @pattern page-actions
 * @ai-summary Shared action-button cluster (Cleanup, Publish) that lives in
 *   the filter row on the dashboard and inside `desktopExtras` on the Vibe
 *   page. Navigation (Jobs, Workers, Changelog) moved to the persistent
 *   <Sidebar />; only true actions remain here.
 */
"use client";

import { GitBranch } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { PublishButton } from "./PublishButton";
import { SimpleTooltip } from "./SimpleTooltip";

interface PageActionsProps {
  onOpenBranchCleanup: () => void;
  onPublished?: (issueNumber: number) => void;
  actorLogin?: string;
}

export function PageActions({
  onOpenBranchCleanup,
  onPublished,
  actorLogin,
}: PageActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <SimpleTooltip content="Clean up branches" side="bottom">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenBranchCleanup}
          aria-label="Clean up branches"
        >
          <GitBranch className="w-4 h-4" />
        </Button>
      </SimpleTooltip>

      <PublishButton actorLogin={actorLogin} onPublished={onPublished} />
    </div>
  );
}
