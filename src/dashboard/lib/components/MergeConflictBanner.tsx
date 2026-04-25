/**
 * @fileType component
 * @domain kody
 * @pattern merge-conflict-banner
 * @ai-summary Sticky banner shown when a PR has merge conflicts; offers a one-click @kody resolve
 */
"use client";

import { useState } from "react";
import { AlertTriangle, GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { usePRCIStatus } from "../hooks/usePRCIStatus";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { prsApi } from "../api";

interface MergeConflictBannerProps {
  prNumber: number;
}

export function MergeConflictBanner({ prNumber }: MergeConflictBannerProps) {
  const { data } = usePRCIStatus(prNumber);
  const { githubUser } = useGitHubIdentity();
  const [isResolving, setIsResolving] = useState(false);

  if (!data?.hasConflicts) return null;

  const handleResolve = async () => {
    setIsResolving(true);
    try {
      await prsApi.postComment(prNumber, "@kody resolve", githubUser?.login);
      toast.success("Resolve requested — Kody will rebase and push");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to request resolve",
      );
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-t border-red-500/30 bg-red-500/10">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-300 font-medium">
          Branch has conflicts with the base branch
        </p>
        <p className="text-xs text-red-400/80">
          Merge is blocked until conflicts are resolved.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleResolve}
        disabled={isResolving}
        className="gap-1.5 text-red-300 border-red-500/40 hover:bg-red-500/20 shrink-0"
      >
        {isResolving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <GitMerge className="w-3.5 h-3.5" />
        )}
        <span>Resolve</span>
      </Button>
    </div>
  );
}
