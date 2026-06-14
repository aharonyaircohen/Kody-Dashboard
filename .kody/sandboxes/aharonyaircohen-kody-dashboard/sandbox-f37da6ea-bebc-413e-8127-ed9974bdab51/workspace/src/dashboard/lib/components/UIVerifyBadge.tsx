/**
 * @fileType component
 * @domain ui-verify
 * @pattern status-badge
 *
 * Renders a small ✓ / ✗ chip on a task card when the auto UI-verify
 * gate has produced a verdict for the PR.
 *
 *   kody:ui-verified → green ✓ ("UI verified")
 *   kody:ui-failed   → red   ✗ ("UI verification failed")
 *
 * Returns null when neither label is present. Reading labels off the
 * already-fetched `associatedPR` avoids any extra GitHub call —
 * critical given the shared-token rate-limit budget.
 */
"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { UI_VERIFIED, UI_FAILED } from "../ui-verify/labels";
import { cn } from "../utils";
import { SimpleTooltip } from "./SimpleTooltip";

interface UIVerifyBadgeProps {
  prLabels: string[] | undefined;
  className?: string;
}

export function UIVerifyBadge({ prLabels, className }: UIVerifyBadgeProps) {
  if (!prLabels || prLabels.length === 0) return null;

  const verified = prLabels.includes(UI_VERIFIED);
  const failed = prLabels.includes(UI_FAILED);
  if (!verified && !failed) return null;

  // If both somehow exist, prefer the failure signal — a known regression
  // is more important to surface than a stale verified flag.
  const state = failed ? "failed" : "verified";

  const config =
    state === "verified"
      ? {
          Icon: CheckCircle2,
          color: "text-emerald-400",
          tooltip: "UI verified by kody ui-review",
        }
      : {
          Icon: XCircle,
          color: "text-red-400",
          tooltip: "UI verification failed — see review comment on PR",
        };

  const { Icon } = config;

  return (
    <SimpleTooltip content={config.tooltip} side="bottom">
      <span
        className={cn(
          "inline-flex items-center gap-1",
          config.color,
          className,
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
    </SimpleTooltip>
  );
}
