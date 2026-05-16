/**
 * @fileType component
 * @domain kody
 * @pattern page-actions
 * @ai-summary Shared icon-button cluster (Jobs, Changelog, Cleanup, Publish)
 *   that used to live on the right of KodyHeader. Lives in the filter row on
 *   the dashboard and inside `desktopExtras` on the Vibe page so both surfaces
 *   keep the same actions while the global header stays minimal.
 */
"use client";

import Link from "next/link";
import { Bot, GitBranch, Layers, ScrollText } from "lucide-react";

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
      <SimpleTooltip content="Jobs" side="bottom">
        <Button asChild variant="outline" size="sm" aria-label="Jobs">
          <Link href="/jobs">
            <Layers className="w-4 h-4" />
          </Link>
        </Button>
      </SimpleTooltip>

      <SimpleTooltip content="Workers" side="bottom">
        <Button asChild variant="outline" size="sm" aria-label="Workers">
          <Link href="/workers">
            <Bot className="w-4 h-4" />
          </Link>
        </Button>
      </SimpleTooltip>

      <SimpleTooltip content="Changelog" side="bottom">
        <Button asChild variant="outline" size="sm" aria-label="Changelog">
          <Link href="/changelog">
            <ScrollText className="w-4 h-4" />
          </Link>
        </Button>
      </SimpleTooltip>

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
