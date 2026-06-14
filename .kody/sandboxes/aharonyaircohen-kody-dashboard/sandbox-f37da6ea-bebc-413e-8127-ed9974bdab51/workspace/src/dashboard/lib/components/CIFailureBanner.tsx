/**
 * @fileType component
 * @domain kody
 * @pattern ci-failure-banner
 * @ai-summary Sticky banner shown when a PR has failing CI; offers a one-click @kody fix-ci
 */
"use client";

import { useState } from "react";
import { AlertTriangle, Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { usePRCIStatus } from "../hooks/usePRCIStatus";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { prsApi } from "../api";

interface CIFailureBannerProps {
  prNumber: number;
}

export function CIFailureBanner({ prNumber }: CIFailureBannerProps) {
  const { data } = usePRCIStatus(prNumber);
  const { githubUser } = useGitHubIdentity();
  const [isFixing, setIsFixing] = useState(false);

  // Hide when CI isn't failing, or when conflicts banner is already showing
  // (Resolve takes priority — fix-ci on a conflicted branch is futile).
  if (!data || data.ciStatus !== "failure" || data.hasConflicts) return null;

  const handleFixCI = async () => {
    setIsFixing(true);
    try {
      await prsApi.postComment(prNumber, "@kody fix-ci", githubUser?.login);
      toast.success("Fix CI requested — Kody will investigate and push a fix");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to request fix-ci",
      );
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-t border-red-500/30 bg-red-500/10">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-300 font-medium">
          CI checks are failing on this PR
        </p>
        <p className="text-xs text-red-400/80">
          Merge is blocked until CI passes.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleFixCI}
        disabled={isFixing}
        className="gap-1.5 text-red-300 border-red-500/40 hover:bg-red-500/20 shrink-0"
      >
        {isFixing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Activity className="w-3.5 h-3.5" />
        )}
        <span>Fix CI</span>
      </Button>
    </div>
  );
}
