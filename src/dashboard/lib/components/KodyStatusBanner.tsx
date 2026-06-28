/**
 * @fileType component
 * @domain kody
 * @pattern kody-status-banner
 * @ai-summary Banner showing CI health on the default branch (primary signal)
 *   plus a secondary roll-up of CI status across in-flight PRs. The default-
 *   branch state is what gates autonomous agents — they branch off main, so a
 *   red main means new work starts on a broken base.
 */
"use client";

import { useState, useEffect, type ReactNode } from "react";
import { formatElapsed } from "../pipeline-utils";
import type { KodyTask } from "../types";
import type { DefaultBranchCI } from "../api";
import { Loader2 } from "lucide-react";
import { Badge } from "@dashboard/ui/badge";

interface KodyStatusBannerProps {
  tasks: KodyTask[];
  /** Default-branch CI roll-up. Undefined while the first fetch is in flight. */
  mainCi?: DefaultBranchCI;
  /** Whether the main-CI query is currently fetching (initial or background). */
  mainCiLoading?: boolean;
  /** Whether a background refetch of the tasks list is in progress. */
  isFetching?: boolean;
  /** Timestamp (ms) of last successful tasks data update. */
  dataUpdatedAt?: number;
  /** Extra controls rendered on the right side of the banner (e.g. expand/collapse all). */
  trailing?: ReactNode;
}

interface PRCIRollup {
  /** PRs with `ciStatus === 'failure'`. */
  ciFailing: number;
  /** PRs with `ciStatus === 'running' | 'pending'`. */
  ciRunning: number;
  /** PRs with `ciStatus === 'success'` (and not merged). Ready to land. */
  ciReady: number;
  /** Tasks in flight without a PR yet (taskify/architect/build before PR opens). */
  noPrYet: number;
  /** Total in-flight tasks (building or retrying). */
  workingCount: number;
}

function rollupPrCi(tasks: KodyTask[]): PRCIRollup {
  const working = tasks.filter(
    (t) => t.column === "building" || t.column === "retrying",
  );
  let ciFailing = 0;
  let ciRunning = 0;
  let ciReady = 0;
  let noPrYet = 0;
  for (const t of working) {
    const ci = t.associatedPR?.ciStatus;
    if (!t.associatedPR) {
      noPrYet++;
      continue;
    }
    if (ci === "failure") ciFailing++;
    else if (ci === "running" || ci === "pending") ciRunning++;
    else if (ci === "success") ciReady++;
  }
  return {
    ciFailing,
    ciRunning,
    ciReady,
    noPrYet,
    workingCount: working.length,
  };
}

/** Subtle refresh indicator — shows spinner when fetching, "Updated Xs ago" otherwise */
function RefreshIndicator({
  isFetching,
  dataUpdatedAt,
}: {
  isFetching?: boolean;
  dataUpdatedAt?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  if (!dataUpdatedAt) return null;
  const ago = formatElapsed(new Date(dataUpdatedAt));
  return (
    <span className="inline-flex items-center gap-1.5 text-body-xs text-muted-foreground/60 ml-auto shrink-0">
      {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      <span className="hidden sm:inline">{ago} ago</span>
    </span>
  );
}

interface BannerTone {
  container: string;
  dot: string;
  ping?: string;
  pulse?: boolean;
}

function bannerTone(state: DefaultBranchCI["state"] | "loading"): BannerTone {
  switch (state) {
    case "failure":
      return {
        container:
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-6 py-3 border-b border-white/[0.06] bg-red-500/[0.06]",
        dot: "bg-red-500",
      };
    case "pending":
      return {
        container:
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-6 py-3 border-b border-white/[0.06] bg-blue-500/[0.06]",
        dot: "bg-blue-500",
        ping: "bg-blue-400",
      };
    case "success":
      return {
        container:
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]",
        dot: "bg-emerald-500",
      };
    case "loading":
      return {
        container:
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]",
        dot: "bg-muted-foreground/40",
      };
    default:
      return {
        container:
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]",
        dot: "bg-muted-foreground/40",
      };
  }
}

function renderPrPills(rollup: PRCIRollup): ReactNode[] {
  const pills: ReactNode[] = [];
  if (rollup.workingCount === 0) return pills;

  pills.push(
    <Badge
      key="working"
      variant="outline"
      className="text-muted-foreground border-muted-foreground/30"
      title={`${rollup.workingCount} task(s) in flight (building or retrying)`}
    >
      {rollup.workingCount} in flight
    </Badge>,
  );
  if (rollup.ciReady > 0) {
    pills.push(
      <Badge
        key="ready"
        variant="outline"
        className="text-emerald-400 border-emerald-500/30"
        title={`${rollup.ciReady} PR(s) with green CI, ready to merge`}
      >
        {rollup.ciReady} ready
      </Badge>,
    );
  }
  if (rollup.ciRunning > 0) {
    pills.push(
      <Badge
        key="running"
        variant="outline"
        className="text-blue-400 border-blue-500/30"
        title={`${rollup.ciRunning} PR(s) with CI in progress`}
      >
        {rollup.ciRunning} CI running
      </Badge>,
    );
  }
  if (rollup.ciFailing > 0) {
    pills.push(
      <Badge
        key="failing"
        variant="outline"
        className="text-red-400 border-red-500/40"
        title={`${rollup.ciFailing} PR(s) with failing CI`}
      >
        {rollup.ciFailing} CI failing
      </Badge>,
    );
  }
  if (rollup.noPrYet > 0) {
    pills.push(
      <Badge
        key="no-pr"
        variant="outline"
        className="text-muted-foreground border-muted-foreground/30"
        title={`${rollup.noPrYet} task(s) in flight before a PR has opened (taskify / architect / pre-PR build)`}
      >
        {rollup.noPrYet} pre-PR
      </Badge>,
    );
  }
  return pills;
}

export function KodyStatusBanner({
  tasks,
  mainCi,
  mainCiLoading,
  isFetching,
  dataUpdatedAt,
  trailing,
}: KodyStatusBannerProps) {
  const ciState: DefaultBranchCI["state"] | "loading" = mainCi
    ? mainCi.state
    : mainCiLoading
      ? "loading"
      : "unknown";
  const tone = bannerTone(ciState);
  const prPills = renderPrPills(rollupPrCi(tasks));

  let primary: ReactNode;
  if (ciState === "failure" && mainCi) {
    const failingCount = mainCi.failingRuns.length;
    const firstFailing = mainCi.failingRuns[0];
    primary = (
      <span className="text-body-sm">
        <span className="text-red-400 font-medium">
          CI failing on {mainCi.branch}
        </span>{" "}
        {firstFailing ? (
          <a
            href={firstFailing.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-red-400 hover:underline"
            title={`View failing run: ${firstFailing.name}`}
          >
            — {firstFailing.name}
            {failingCount > 1 ? ` +${failingCount - 1} more` : ""}
          </a>
        ) : null}
      </span>
    );
  } else if (ciState === "pending" && mainCi) {
    primary = (
      <span className="text-body-sm">
        <span className="text-blue-400 font-medium">
          CI running on {mainCi.branch}
        </span>{" "}
        {mainCi.latestRun ? (
          <a
            href={mainCi.latestRun.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:underline"
            title={`Latest run: ${mainCi.latestRun.name}`}
          >
            — {mainCi.latestRun.name}
          </a>
        ) : null}
      </span>
    );
  } else if (ciState === "success" && mainCi) {
    primary = (
      <span className="text-body-sm text-muted-foreground">
        CI <span className="text-emerald-400 font-medium">green</span> on{" "}
        {mainCi.branch}
      </span>
    );
  } else if (ciState === "loading") {
    primary = (
      <span className="text-body-sm text-muted-foreground">Checking CI…</span>
    );
  } else {
    primary = (
      <span className="text-body-sm text-muted-foreground">
        CI status <span className="text-foreground font-medium">unknown</span>
        {mainCi ? ` on ${mainCi.branch}` : ""}
      </span>
    );
  }

  return (
    <div className={tone.container}>
      <span className="relative flex h-3 w-3">
        {tone.ping ? (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${tone.ping}`}
          />
        ) : null}
        <span
          className={`relative inline-flex rounded-full h-3 w-3 ${tone.dot}`}
        />
      </span>
      {primary}
      {prPills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">{prPills}</div>
      ) : null}
      <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
      {trailing}
    </div>
  );
}
