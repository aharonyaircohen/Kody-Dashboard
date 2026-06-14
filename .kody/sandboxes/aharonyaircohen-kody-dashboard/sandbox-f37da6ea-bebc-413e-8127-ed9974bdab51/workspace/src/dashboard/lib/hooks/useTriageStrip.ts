/**
 * @fileType hook
 * @domain kody
 * @pattern triage-strip
 * @ai-summary Cross-tile triage list for the dashboard homepage. Pulls items
 *   from the same hooks the source cards already poll (CI, tasks, duties,
 *   engine health), ranks them by severity × age, and lets the operator
 *   dismiss with a 4-hour TTL so the strip doesn't get noisy.
 *
 *   The goal: the operator's first question is "what do I look at first?"
 *   Triage answers it in a single ordered list instead of forcing a sweep
 *   across four independent cards.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useKodyTasks } from "./index";
import { useDefaultBranchCI } from "./useDefaultBranchCI";
import { useDuties, useRunDuty } from "./useDuties";
import { useHealth } from "./useHealth";
import { useRerunCIRun, useRetryTask } from "./useDashboardActions";
import { useGitHubIdentity } from "./useGitHubIdentity";

export type TriageSeverity = 1 | 2 | 3 | 4 | 5;

export interface TriageAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
}

export interface TriageItem {
  /** Stable id; used as the dismiss key and React list key. */
  id: string;
  severity: TriageSeverity;
  title: string;
  detail?: string;
  /** Internal app route or absolute https URL. */
  href?: string;
  /** ISO timestamp — older sorts higher within the same severity band. */
  occurredAt: string;
  action?: TriageAction;
}

const DISMISS_STORAGE_KEY = "kody.triage.dismissed";
const DISMISS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

type DismissMap = Record<string, string>;

function readDismissed(): DismissMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: DismissMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeDismissed(map: DismissMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private mode / quota — UI still works from in-memory state
  }
}

function useDismissedState(): [DismissMap, (id: string) => void] {
  const [dismissed, setDismissed] = useState<DismissMap>({});

  useEffect(() => {
    setDismissed(readDismissed());
    function onStorage(e: StorageEvent) {
      if (e.key === DISMISS_STORAGE_KEY) setDismissed(readDismissed());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: new Date().toISOString() };
      writeDismissed(next);
      return next;
    });
  }, []);

  return [dismissed, dismiss];
}

export interface UseTriageStripResult {
  items: TriageItem[];
  dismiss: (id: string) => void;
}

export function useTriageStrip(limit = 4): UseTriageStripResult {
  const { data: ci } = useDefaultBranchCI();
  const { data: tasks } = useKodyTasks();
  const { data: duties } = useDuties();
  const { data: health } = useHealth();
  const { githubUser } = useGitHubIdentity();
  const rerunCI = useRerunCIRun();
  const retryTask = useRetryTask(githubUser?.login);
  const runDuty = useRunDuty();
  const [dismissed, dismiss] = useDismissedState();

  const items = useMemo<TriageItem[]>(() => {
    const out: TriageItem[] = [];
    const now = Date.now();

    // Engine down — severity 5 (runs are blocked)
    if (health?.level === "down") {
      for (const s of health.signals ?? []) {
        if (s.level !== "down") continue;
        out.push({
          id: `engine-down:${s.id}`,
          severity: 5,
          title: `Engine down: ${s.label}`,
          detail: s.detail,
          href: s.url,
          occurredAt: s.at ?? new Date(0).toISOString(),
        });
      }
    }

    // Failing CI on default branch — severity 4
    if (ci?.state === "failure" && ci.latestRun) {
      out.push({
        id: `ci:${ci.latestRun.id}`,
        severity: 4,
        title: `CI red on ${ci.branch}`,
        detail: ci.latestRun.name,
        href: ci.latestRun.html_url,
        occurredAt: ci.latestRun.updated_at,
        action: {
          label: "Re-run",
          onClick: () => rerunCI.mutate(ci.latestRun!.id),
          pending: rerunCI.isPending,
        },
      });
    }

    // Failed tasks — severity 3 (top 3 only)
    for (const t of (tasks ?? [])
      .filter((t) => t.column === "failed")
      .slice(0, 3)) {
      out.push({
        id: `task:${t.id}`,
        severity: 3,
        title: `#${t.issueNumber} ${t.title}`,
        detail: t.failureReason,
        href: `/${t.issueNumber}`,
        occurredAt: t.updatedAt,
        action: {
          label: "Retry",
          onClick: () => retryTask.mutate(t.issueNumber),
          pending: retryTask.isPending,
        },
      });
    }

    // Failing duties — severity 2
    for (const d of (duties ?? [])
      .filter((d) => !d.disabled && d.lastOutcome === "failed")
      .slice(0, 2)) {
      out.push({
        id: `duty:${d.slug}`,
        severity: 2,
        title: `Duty: ${d.title}`,
        detail: d.runner ?? undefined,
        href: "/duties",
        occurredAt: d.lastTickAt ?? d.updatedAt,
        action: {
          label: "Re-run",
          onClick: () => runDuty.mutate({ slug: d.slug }),
          pending: runDuty.isPending,
        },
      });
    }

    // Engine degraded signals — severity 2
    for (const s of health?.signals ?? []) {
      if (s.level !== "degraded") continue;
      out.push({
        id: `engine-degraded:${s.id}`,
        severity: 2,
        title: s.label,
        detail: s.detail,
        href: s.url,
        occurredAt: s.at ?? new Date(0).toISOString(),
      });
    }

    // Severity DESC, then older-first within a band (so the same problem
    // that hasn't moved escalates within its tier).
    out.sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    });

    // Drop items dismissed within the TTL — operator has already triaged.
    return out
      .filter((it) => {
        const at = dismissed[it.id];
        if (!at) return true;
        return now - Date.parse(at) >= DISMISS_TTL_MS;
      })
      .slice(0, limit);
  }, [
    ci,
    tasks,
    duties,
    health,
    dismissed,
    rerunCI,
    retryTask,
    runDuty,
    limit,
  ]);

  return { items, dismiss };
}
