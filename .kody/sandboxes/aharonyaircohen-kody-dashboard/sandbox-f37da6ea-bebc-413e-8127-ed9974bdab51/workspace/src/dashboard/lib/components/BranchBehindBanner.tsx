/**
 * @fileType component
 * @domain kody
 * @pattern branch-behind-banner
 * @ai-summary Soft warning when a PR's head branch is behind its base.
 * Non-blocking (unlike Conflict) — surfaces a one-click @kody sync. Still shown
 * alongside a failing-CI banner: a stale branch is often *why* CI is red, so the
 * sync offer must stay visible. Only a merge conflict suppresses it (sync can't
 * cleanly merge then).
 */
"use client";

import { useState } from "react";
import { GitPullRequestArrow, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { usePRCIStatus } from "../hooks/usePRCIStatus";
import { usePRBehind } from "../hooks/usePRBehind";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { prsApi } from "../api";

interface BranchBehindBannerProps {
  prNumber: number;
}

export function BranchBehindBanner({ prNumber }: BranchBehindBannerProps) {
  const { data: ciData } = usePRCIStatus(prNumber);
  const { data: behindBy } = usePRBehind(prNumber);
  const { githubUser } = useGitHubIdentity();
  const [isSyncing, setIsSyncing] = useState(false);

  // A merge conflict is the only hard blocker for sync — @kody sync can't
  // cleanly merge base in then, so let the Conflict banner own that case.
  // A failing CI does NOT hide this: the branch being behind is frequently the
  // cause of the failure, so show the sync offer next to the CI-failure banner.
  if (!behindBy || behindBy <= 0) return null;
  if (ciData?.hasConflicts) return null;

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await prsApi.postComment(prNumber, "@kody sync", githubUser?.login);
      toast.success("Update requested");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to request update",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const plural = behindBy === 1 ? "change" : "changes";

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-t border-cyan-500/30 bg-cyan-500/10">
      <GitPullRequestArrow className="w-4 h-4 text-cyan-300 shrink-0" />
      <p className="flex-1 min-w-0 text-sm text-cyan-200 font-medium">
        Preview is out of date ({behindBy} {plural} behind).
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={isSyncing}
        className="gap-1.5 text-cyan-200 border-cyan-500/40 hover:bg-cyan-500/20 shrink-0"
      >
        {isSyncing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
        <span>Update</span>
      </Button>
    </div>
  );
}
