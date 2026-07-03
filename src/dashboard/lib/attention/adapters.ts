/**
 * @fileType utility
 * @domain kody
 * @pattern attention-adapters
 * @ai-summary Pure-ish adapters from existing dashboard records into the
 *   shared AttentionItem contract. They only shape presentation and attach
 *   caller-provided actions; they do not invent backend behavior.
 */

import type { DefaultBranchCI, Report } from "../api";
import { managedGoalModel, type ManagedGoalRecord } from "../managed-goals";
import type { ActionLogEntry } from "../activity/action-log";
import type { HealthReport, HealthSignal } from "../health/types";
import type { ColumnId, KodyTask } from "../types";
import type { AttentionAction, AttentionItem, AttentionProof } from "./types";

const IN_FLIGHT_COLUMNS = new Set<ColumnId>(["building", "retrying", "review"]);

function firstPresent<T>(
  ...values: Array<T | null | undefined>
): T | undefined {
  return values.find((v): v is T => v !== null && v !== undefined);
}

function latestIso(
  ...values: Array<string | null | undefined>
): string | undefined {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time)[0];
  return latest?.value;
}

function taskProof(task: KodyTask): AttentionProof | undefined {
  if (task.associatedPR?.html_url) {
    return {
      label: `PR #${task.associatedPR.number}`,
      href: task.associatedPR.html_url,
      kind: "pr",
    };
  }
  if (task.previewUrl) {
    return { label: "Preview", href: task.previewUrl, kind: "preview" };
  }
  if (task.workflowRun?.html_url) {
    return { label: "Run", href: task.workflowRun.html_url, kind: "run" };
  }
  return undefined;
}

function openAction(href: string, label = "Open"): AttentionAction {
  return { id: "open", kind: "open", label, href };
}

function proofAction(proof: AttentionProof): AttentionAction {
  return {
    id: "proof",
    kind: "view-proof",
    label: proof.label,
    href: proof.href,
    external: proof.href.startsWith("http"),
  };
}

function dismissAction(
  onDismiss?: (id: string) => void,
  id?: string,
): AttentionAction[] {
  if (!onDismiss || !id) return [];
  return [
    {
      id: "dismiss",
      kind: "dismiss",
      label: "Dismiss",
      title: "Hide this item for a few hours on this device",
      onClick: () => onDismiss(id),
    },
  ];
}

export interface TaskAttentionOptions {
  onRetry?: (issueNumber: number) => void;
  retryPending?: boolean;
  onStop?: (issueNumber: number) => void;
  stopPending?: boolean;
  onDismiss?: (id: string) => void;
}

export function taskAttentionItems(
  tasks: KodyTask[],
  options: TaskAttentionOptions = {},
): AttentionItem[] {
  return tasks.flatMap<AttentionItem>((task) => {
    const href = `/${task.issueNumber}`;
    const proof = taskProof(task);
    const proofActions = proof ? [proofAction(proof)] : [];
    const occurredAt = latestIso(task.workflowRun?.updated_at, task.updatedAt);
    const owner = task.assignees?.map((a) => a.login).join(", ") || undefined;

    if (task.column === "failed") {
      const id = `task:${task.issueNumber}:failed`;
      return [
        {
          id,
          source: "task",
          section: "needs_you",
          status: "failed",
          severity: 4,
          title: `#${task.issueNumber} ${task.title}`,
          reason: task.failureReason || "Task failed.",
          href,
          owner,
          occurredAt,
          proof,
          actions: [
            openAction(href),
            ...proofActions,
            ...(options.onRetry
              ? [
                  {
                    id: "retry",
                    kind: "retry" as const,
                    label: "Retry",
                    variant: "primary" as const,
                    pending: options.retryPending,
                    onClick: () => options.onRetry?.(task.issueNumber),
                  },
                ]
              : []),
            ...dismissAction(options.onDismiss, id),
          ],
        },
      ];
    }

    if (task.column === "gate-waiting" || task.clarifyWaiting) {
      const id = `task:${task.issueNumber}:waiting`;
      const gate =
        task.gateStage && task.gateType
          ? `${task.gateType} at ${task.gateStage}`
          : task.clarifyWaiting
            ? "Waiting for an answer."
            : "Waiting at a gate.";
      return [
        {
          id,
          source: "task",
          section: "needs_you",
          status: "waiting",
          severity: task.gateType === "hard-stop" ? 4 : 3,
          title: `#${task.issueNumber} ${task.title}`,
          reason: gate,
          href,
          owner,
          occurredAt,
          proof,
          actions: [
            openAction(href),
            ...proofActions,
            ...dismissAction(options.onDismiss, id),
          ],
        },
      ];
    }

    if (IN_FLIGHT_COLUMNS.has(task.column)) {
      const id = `task:${task.issueNumber}:running`;
      return [
        {
          id,
          source: "task",
          section: "running",
          status: "running",
          severity: 2,
          title: `#${task.issueNumber} ${task.title}`,
          reason:
            task.column === "review"
              ? "In review."
              : task.column === "retrying"
                ? "Retrying."
                : "Running now.",
          href,
          owner,
          occurredAt,
          proof,
          actions: [
            openAction(href),
            ...proofActions,
            ...(options.onStop
              ? [
                  {
                    id: "stop",
                    kind: "stop" as const,
                    label: "Stop",
                    variant: "danger" as const,
                    pending: options.stopPending,
                    onClick: () => options.onStop?.(task.issueNumber),
                  },
                ]
              : []),
          ],
        },
      ];
    }

    if (task.column === "done") {
      return [
        {
          id: `task:${task.issueNumber}:done`,
          source: "task",
          section: "done",
          status: "done",
          severity: 1,
          title: `#${task.issueNumber} ${task.title}`,
          reason: "Task finished.",
          href,
          owner,
          occurredAt,
          proof,
          actions: [openAction(href), ...proofActions],
        },
      ];
    }

    return [];
  });
}

export interface CiAttentionOptions {
  onRerun?: (runId: number) => void;
  rerunPending?: boolean;
  onCreateFixTask?: () => void;
  createFixPending?: boolean;
  onDismiss?: (id: string) => void;
}

export function ciAttentionItems(
  ci: DefaultBranchCI | undefined,
  options: CiAttentionOptions = {},
): AttentionItem[] {
  if (!ci) return [];
  const run = ci.latestRun;

  if (ci.state === "failure" && run) {
    const id = `ci:${run.id}:failure`;
    return [
      {
        id,
        source: "ci",
        section: "needs_you",
        status: "failed",
        severity: 4,
        title: `${ci.branch} CI is red`,
        reason: run.name,
        href: run.html_url,
        occurredAt: run.updated_at,
        proof: { label: "Run", href: run.html_url, kind: "run" },
        actions: [
          proofAction({ label: "Run", href: run.html_url, kind: "run" }),
          ...(options.onRerun
            ? [
                {
                  id: "rerun",
                  kind: "retry" as const,
                  label: "Re-run",
                  variant: "primary" as const,
                  pending: options.rerunPending,
                  onClick: () => options.onRerun?.(run.id),
                },
              ]
            : []),
          ...(options.onCreateFixTask
            ? [
                {
                  id: "fix-ci",
                  kind: "create-task" as const,
                  label: "Fix CI",
                  pending: options.createFixPending,
                  onClick: options.onCreateFixTask,
                },
              ]
            : []),
          ...dismissAction(options.onDismiss, id),
        ],
      },
    ];
  }

  if (ci.state === "pending" && run) {
    return [
      {
        id: `ci:${run.id}:running`,
        source: "ci",
        section: "running",
        status: "running",
        severity: 1,
        title: `${ci.branch} CI is running`,
        reason: run.name,
        href: run.html_url,
        occurredAt: run.updated_at,
        proof: { label: "Run", href: run.html_url, kind: "run" },
        actions: [
          proofAction({ label: "Run", href: run.html_url, kind: "run" }),
        ],
      },
    ];
  }

  return [
    {
      id: `ci:${ci.branch}:healthy`,
      source: "ci",
      section: "quiet",
      status: "healthy",
      severity: 1,
      title: `${ci.branch} CI`,
      reason: ci.state === "success" ? "Green." : "No blocking CI signal.",
      occurredAt: firstPresent(run?.updated_at, ci.fetchedAt),
      proof: run
        ? { label: "Run", href: run.html_url, kind: "run" }
        : undefined,
      actions: run
        ? [proofAction({ label: "Run", href: run.html_url, kind: "run" })]
        : [],
    },
  ];
}

export function reportAttentionItems(
  reports: Report[],
  onDismiss?: (id: string) => void,
): AttentionItem[] {
  return reports.flatMap((report) => {
    const href = `/reports/${report.slug}`;
    const needsReview =
      report.reviewStatus === "action-needed" ||
      report.reviewStatus === "assigned" ||
      (report.suggestedActions ?? []).length > 0;
    const id = `report:${report.slug}:${needsReview ? "review" : "done"}`;
    const proof = { label: "Report", href, kind: "report" as const };
    return [
      {
        id,
        source: "report",
        section: needsReview ? "needs_you" : "done",
        status: needsReview ? "waiting" : "done",
        severity: needsReview ? 3 : 1,
        title: report.title,
        reason: needsReview
          ? report.reviewStatus === "assigned"
            ? "Assigned for review."
            : `${report.suggestedActions.length} suggested action${
                report.suggestedActions.length === 1 ? "" : "s"
              }.`
          : report.findingCount > 0
            ? `${report.findingCount} finding${report.findingCount === 1 ? "" : "s"}.`
            : "Report saved.",
        href,
        occurredAt: report.updatedAt,
        proof,
        actions: [
          openAction(href, needsReview ? "Review" : "Open"),
          ...(needsReview ? dismissAction(onDismiss, id) : []),
        ],
      },
    ];
  });
}

function healthStatus(signal: HealthSignal): AttentionItem["status"] {
  if (signal.level === "down") return "blocked";
  if (signal.level === "degraded") return "waiting";
  return "healthy";
}

export function healthAttentionItems(
  report: HealthReport | undefined,
  onDismiss?: (id: string) => void,
): AttentionItem[] {
  if (!report) return [];
  const problemSignals = report.signals.filter((s) => s.level !== "ok");
  if (problemSignals.length === 0) {
    return [
      {
        id: "health:ok",
        source: "health",
        section: "quiet",
        status: "healthy",
        severity: 1,
        title: "Engine health",
        reason: "No blockers.",
        occurredAt: report.checkedAt,
        actions: [openAction("/activity", "Activity")],
      },
    ];
  }

  return problemSignals.map((signal) => {
    const id = `health:${signal.id}:${signal.level}`;
    return {
      id,
      source: "health" as const,
      section: "needs_you" as const,
      status: healthStatus(signal),
      severity: signal.level === "down" ? 5 : 3,
      title: signal.label,
      reason: signal.detail,
      href: signal.url,
      occurredAt: signal.at ?? report.checkedAt,
      actions: [
        ...(signal.url
          ? [openAction(signal.url, "Open")]
          : [openAction("/activity", "Activity")]),
        ...dismissAction(onDismiss, id),
      ],
    };
  });
}

export function activityAttentionItems(
  entries: ActionLogEntry[],
): AttentionItem[] {
  return entries.slice(0, 8).flatMap((entry) => {
    const failed = entry.outcome === "error" || entry.outcome === "denied";
    const href = entry.resourceUrl ?? undefined;
    return [
      {
        id: `activity:${entry.id}`,
        source: "activity",
        section: failed ? "needs_you" : "done",
        status: failed ? "failed" : "done",
        severity: failed ? 3 : 1,
        title: `${entry.type}: ${entry.target}`,
        reason:
          entry.detail ||
          (failed ? "Action needs review." : "Action recorded."),
        href,
        owner:
          entry.actor && entry.actor !== "unknown" ? entry.actor : undefined,
        occurredAt: entry.at,
        proof: href ? { label: "Source", href, kind: "log" } : undefined,
        actions: href ? [openAction(href, "Open")] : [],
      },
    ];
  });
}

export function goalAttentionItems(
  goals: ManagedGoalRecord[],
): AttentionItem[] {
  return goals.flatMap<AttentionItem>((goal) => {
    const kind = managedGoalModel(goal);
    const href = kind === "agentLoop" ? "/agent-loops" : "/agent-goals";
    const title = goal.state.destination.outcome || goal.id;
    const blockers = goal.state.blockers ?? [];
    const occurredAt = latestIso(
      goal.updatedAt,
      typeof goal.state.updatedAt === "string"
        ? goal.state.updatedAt
        : undefined,
      typeof goal.state.createdAt === "string"
        ? goal.state.createdAt
        : undefined,
    );

    if (blockers.length > 0 || goal.state.state === "paused") {
      return [
        {
          id: `goal:${goal.id}:blocked`,
          source: "goal",
          section: "needs_you",
          status: "blocked",
          severity: 3,
          title,
          reason: blockers[0] || "Paused.",
          href,
          occurredAt,
          actions: [openAction(href, "Open")],
        },
      ];
    }

    if (goal.state.state === "active") {
      return [
        {
          id: `goal:${goal.id}:running`,
          source: "goal",
          section: "running",
          status: "running",
          severity: 1,
          title,
          reason: kind === "agentLoop" ? "Loop is active." : "Goal is active.",
          href,
          occurredAt,
          actions: [openAction(href, "Open")],
        },
      ];
    }

    return [
      {
        id: `goal:${goal.id}:quiet`,
        source: "goal",
        section: goal.state.state === "done" ? "done" : "quiet",
        status: goal.state.state === "done" ? "done" : "healthy",
        severity: 1,
        title,
        reason:
          goal.state.state === "done"
            ? "Goal completed."
            : kind === "agentLoop"
              ? "Loop configured."
              : "Goal configured.",
        href,
        occurredAt,
        actions: [openAction(href, "Open")],
      },
    ];
  });
}

export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    const atA = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const atB = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return atB - atA;
  });
}
