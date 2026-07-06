/**
 * @fileType component
 * @domain kody
 * @pattern agency-runs-page
 * @ai-summary Read-only AI Agency run monitor for goals, loops, and workflows.
 */
"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  ExternalLink,
  Loader2,
  RefreshCw,
  Route,
  XCircle,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { useAgencyRunDetail, useAgencyRuns } from "../hooks/useAgencyRuns";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { DEFAULT_KODY_STORE_REPO_URL, useAuth } from "../auth-context";
import type {
  AgencyRunKind,
  AgencyRunStatus,
  AgencyRunSummary,
} from "../agency-runs";
import type { RepoRef } from "../routes";
import { cn } from "../utils";
import { PageShell } from "./PageShell";

const TABS: Array<{ kind: AgencyRunKind; label: string }> = [
  { kind: "goal", label: "Goals" },
  { kind: "loop", label: "Loops" },
  { kind: "workflow", label: "Workflows" },
];

function formatTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(value: number | null): string {
  if (value === null) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusTone(status: AgencyRunStatus): string {
  if (status === "success")
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (status === "failed")
    return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (status === "stuck") return "border-red-400/30 bg-red-400/10 text-red-200";
  if (status === "blocked")
    return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  if (status === "running")
    return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  if (status === "waiting")
    return "border-violet-400/25 bg-violet-400/10 text-violet-200";
  return "border-white/[0.1] bg-white/[0.04] text-white/55";
}

function eventSummary(event: Record<string, unknown>): {
  event: string;
  time: string;
  status: string | null;
  reason: string | null;
} {
  return {
    event: typeof event.event === "string" ? event.event : "event",
    time: typeof event.time === "string" ? event.time : "",
    status: typeof event.status === "string" ? event.status : null,
    reason:
      typeof event.reason === "string"
        ? event.reason
        : typeof event.summary === "string"
          ? event.summary
          : null,
  };
}

function eventName(event: Record<string, unknown> | null): string | null {
  return textValue(event?.event) ?? textValue(event?.type);
}

function StatusIcon({ status }: { status: AgencyRunStatus }) {
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5" />;
  if (status === "stuck") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === "blocked") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function kindHref(run: AgencyRunSummary): string {
  if (run.kind === "goal")
    return `/agent-goals/${encodeURIComponent(run.targetId)}`;
  if (run.kind === "loop")
    return `/agent-loops/${encodeURIComponent(run.targetId)}`;
  return `/workflows/${encodeURIComponent(run.targetId)}`;
}

function humanStatus(status: AgencyRunStatus): string {
  if (status === "success") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "blocked") return "Blocked";
  if (status === "stuck") return "Stuck";
  if (status === "waiting") return "Waiting";
  if (status === "running") return "Running";
  if (status === "cancelled") return "Cancelled";
  return "Recorded";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dispatchTarget(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^dispatch\s+([^:]+)(?::\s*(.+))?$/i);
  return match?.[1]?.trim() ?? null;
}

function handoffTarget(value: string | null): string | null {
  if (!value) return null;
  const arrowMatch = value.match(/(?:->|→)\s*([A-Za-z0-9_.@-]+)/);
  if (arrowMatch?.[1]) return arrowMatch[1];
  const handoffMatch = value.match(
    /\bhand-?off\b.*?\bto\s+([A-Za-z0-9_.@-]+)/i,
  );
  return handoffMatch?.[1] ?? null;
}

function displayValue(value: string | null): string | null {
  if (!value) return null;
  if (dispatchTarget(value)) return null;
  return value;
}

function eventResultSummary(
  event: Record<string, unknown> | null,
): string | null {
  if (!event) return null;
  const trace = recordValue(event.trace);
  const result = recordValue(trace?.result);
  return (
    textValue(result?.summary) ??
    textValue(event.reason) ??
    textValue(event.summary)
  );
}

function eventDecisionSummary(
  event: Record<string, unknown> | null,
): string | null {
  if (!event) return null;
  const decision = recordValue(event.decision);
  const kind = textValue(decision?.kind);
  const reason = textValue(decision?.reason) ?? textValue(event.reason);
  if (kind && reason) return `${kind}: ${reason}`;
  return kind ?? reason;
}

function operatorHappened(
  run: AgencyRunSummary,
  events: Record<string, unknown>[],
  workflowSummary: string | null,
): string {
  const latest = events.at(-1) ?? null;
  return (
    workflowSummary ??
    eventResultSummary(latest) ??
    eventDecisionSummary(latest) ??
    displayValue(run.summary) ??
    displayValue(run.decision) ??
    "Kody recorded this run."
  );
}

function runtimeLabel(run: AgencyRunSummary): string | null {
  return (
    run.implementation ??
    run.implementation ??
    run.capability ??
    run.workflow ??
    run.action
  );
}

function modelLabel(run: AgencyRunSummary): string | null {
  if (run.modelName && run.model && run.modelName !== run.model) {
    return `${run.modelName} (${run.model})`;
  }
  return run.modelName ?? run.model;
}

export type AgencyRunDiagnosis = {
  status: string;
  pointLabel: string;
  stoppedAt: string;
  why: string;
  lastObserved: string;
  expectedNextEvent: string;
  missingEvidence: string[];
  owner: string;
  nextAction: string;
};

function waitingGoalTarget(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(
    /\b(?:stuck\s+)?waiting on goal\s+([A-Za-z0-9_.@-]+)/i,
  );
  return match?.[1] ?? null;
}

function handoffChain(
  value: string | null,
): { from: string; to: string } | null {
  if (!value) return null;
  const formatted = value.match(
    /\bHand-off:\s*([A-Za-z0-9_.@-]+)\s*(?:->|→)\s*([A-Za-z0-9_.@-]+)/i,
  );
  if (formatted?.[1] && formatted[2])
    return { from: formatted[1], to: formatted[2] };
  const inline = value.match(
    /\b([A-Za-z0-9_.@-]+):\s*in-process hand-off\s*(?:->|→)\s*([A-Za-z0-9_.@-]+)/i,
  );
  if (inline?.[1] && inline[2]) return { from: inline[1], to: inline[2] };
  return null;
}

function firstTextMatch<T>(
  values: string[],
  matcher: (value: string) => T | null,
): T | null {
  for (const value of values) {
    const match = matcher(value);
    if (match) return match;
  }
  return null;
}

function runLabel(run: AgencyRunSummary): string {
  return run.targetLabel || run.targetId;
}

function observedEvent(
  latestName: string | null,
  latestReason: string | null,
  currentStep: string | null,
): string {
  if (latestName && latestReason) return `${latestName}: ${latestReason}`;
  return latestName ?? currentStep ?? "Run record created";
}

function displayedChain(
  chain: { from: string; to: string },
  subject: string,
): string {
  const from = chain.from.toLowerCase() === "kody" ? subject : chain.from;
  return `${from} -> ${chain.to}`;
}

function hasFinalOutcome(
  run: AgencyRunSummary,
  events: Record<string, unknown>[],
): boolean {
  if (["success", "failed", "blocked", "cancelled"].includes(run.status))
    return true;
  return events.some((event) => {
    const name = eventName(event) ?? "";
    const status = textValue(event.status) ?? "";
    return /complete|completed|success|failed|failure|blocked|cancelled|outcome|finish/i.test(
      `${name} ${status}`,
    );
  });
}

export function agencyRunDiagnosis(
  run: AgencyRunSummary,
  events: Record<string, unknown>[],
  workflowLines: string[] = [],
): AgencyRunDiagnosis {
  const latest = events.at(-1) ?? null;
  const latestName = eventName(latest);
  const latestReason =
    eventDecisionSummary(latest) ?? eventResultSummary(latest);
  const diagnosticText = [
    run.summary,
    run.currentStep,
    run.decision,
    latestReason,
    ...workflowLines,
  ].filter((value): value is string => Boolean(value));
  const waitingGoal = firstTextMatch(diagnosticText, waitingGoalTarget);
  const chain = firstTextMatch(diagnosticText, handoffChain);
  const handoff =
    handoffTarget(run.currentStep) ??
    handoffTarget(run.summary) ??
    handoffTarget(latestReason) ??
    chain?.to ??
    waitingGoal;
  const subject = runLabel(run);
  const finalOutcome = hasFinalOutcome(run, events);
  const missingEvidence = [
    waitingGoal && !finalOutcome
      ? `No completion event from ${waitingGoal}.`
      : null,
    !finalOutcome &&
    ["running", "waiting", "stuck", "recorded"].includes(run.status)
      ? "No final outcome event."
      : null,
    !run.sourcePath && events.length === 0 ? "No source log." : null,
    run.githubRunId && !run.githubRunUrl ? "No GitHub run link." : null,
  ].filter((line): line is string => line !== null);

  if (run.status === "stuck") {
    const stoppedAt = waitingGoal
      ? `${subject} -> ${waitingGoal}`
      : chain
        ? displayedChain(chain, subject)
        : handoff
          ? `${subject} -> ${handoff}`
          : (latestName ?? subject);
    return {
      status: "Stuck",
      pointLabel: "Stopped at",
      stoppedAt,
      why: waitingGoal
        ? `${waitingGoal} did not finish or report new progress after ${subject} handed work to it.`
        : chain
          ? `${chain.to} was expected to report back after the hand-off, but no completion event is recorded.`
          : handoff
            ? `${handoff} was expected to report progress or finish, but no completion event is recorded.`
            : latestName
              ? `The run stopped after ${latestName}; no completion event is recorded.`
              : "Kody has no progress event after the run started.",
      lastObserved: observedEvent(latestName, latestReason, run.currentStep),
      expectedNextEvent: waitingGoal
        ? `${waitingGoal} should report progress or completion.`
        : handoff
          ? `${handoff} should report progress or finish.`
          : "The run should report progress or finish.",
      missingEvidence,
      owner: waitingGoal ?? handoff ?? runtimeLabel(run) ?? run.actor ?? "Kody",
      nextAction: waitingGoal
        ? `Inspect ${waitingGoal}'s state or source log, then check why it did not report back to ${subject}.`
        : handoff
          ? `Open the raw timeline or source log and check why ${handoff} did not report back.`
          : "Open the raw timeline or source log and check the last recorded event.",
    };
  }

  if (run.status === "running" || run.status === "waiting") {
    const activePoint = waitingGoal
      ? `${subject} -> ${waitingGoal}`
      : chain
        ? displayedChain(chain, subject)
        : handoff
          ? `${subject} -> ${handoff}`
          : subject;
    return {
      status: humanStatus(run.status),
      pointLabel: run.status === "waiting" ? "Waiting at" : "Current point",
      stoppedAt: activePoint,
      why: waitingGoal
        ? `${subject} is waiting for ${waitingGoal} to report back.`
        : latestName
          ? `The latest event is ${latestName}.`
          : "Kody has not recorded a progress event yet.",
      lastObserved: observedEvent(latestName, latestReason, run.currentStep),
      expectedNextEvent: waitingGoal
        ? `${waitingGoal} should report progress or completion.`
        : handoff
          ? `${handoff} should report progress or finish.`
          : "The run should report progress or finish.",
      missingEvidence,
      owner: waitingGoal ?? handoff ?? runtimeLabel(run) ?? run.actor ?? "Kody",
      nextAction:
        run.status === "waiting"
          ? "Wait for the delegated work to report back, then refresh this page."
          : "Refresh this page or open the raw timeline if it stays unchanged.",
    };
  }

  if (run.status === "failed" || run.status === "blocked") {
    return {
      status: humanStatus(run.status),
      pointLabel: "Stopped at",
      stoppedAt: latestName ?? runtimeLabel(run) ?? subject,
      why:
        latestReason ??
        displayValue(run.decision) ??
        "Kody recorded a stop condition.",
      lastObserved: observedEvent(latestName, latestReason, run.currentStep),
      expectedNextEvent:
        "Operator review is needed before this run can be trusted.",
      missingEvidence,
      owner: runtimeLabel(run) ?? run.actor ?? "Kody",
      nextAction:
        "Open the raw timeline and run evidence to inspect the stop reason.",
    };
  }

  return {
    status: humanStatus(run.status),
    pointLabel:
      run.status === "success" || run.status === "cancelled"
        ? "Ended at"
        : "Recorded at",
    stoppedAt: latestName ?? runtimeLabel(run) ?? subject,
    why:
      run.status === "success"
        ? "Kody recorded a completed run."
        : (latestReason ??
          displayValue(run.summary) ??
          "Kody recorded this run."),
    lastObserved: observedEvent(latestName, latestReason, run.currentStep),
    expectedNextEvent:
      run.status === "success" || run.status === "cancelled"
        ? "No next event is expected."
        : "No expected next event was recorded.",
    missingEvidence,
    owner: runtimeLabel(run) ?? run.actor ?? "Kody",
    nextAction:
      run.status === "success"
        ? "No action needed."
        : "Open the raw timeline and run evidence if this state looks wrong.",
  };
}

export function operatorRunFactLines(run: AgencyRunSummary): string[] {
  const lines = [
    `${run.kind[0]?.toUpperCase() ?? ""}${run.kind.slice(1)}: ${
      run.targetLabel || run.targetId
    }.`,
    `Status: ${humanStatus(run.status)}.`,
    displayValue(run.currentStep) ? `Step: ${run.currentStep}.` : null,
    `Trigger: ${run.origin}.`,
    runtimeLabel(run) ? `Runtime: ${runtimeLabel(run)}.` : null,
    modelLabel(run) ? `Model: ${modelLabel(run)}.` : null,
    run.kodyRunId ? `Kody run: ${run.kodyRunId}.` : null,
    run.githubRunId ? `GitHub run: ${run.githubRunId}.` : null,
    run.startedAt ? `Started: ${formatTime(run.startedAt)}.` : null,
    run.updatedAt ? `Updated: ${formatTime(run.updatedAt)}.` : null,
    run.durationMs !== null
      ? `Duration: ${formatDuration(run.durationMs)}.`
      : null,
  ];
  return lines.filter((line): line is string => line !== null);
}

function rawRunEvidenceLines(run: AgencyRunSummary): string[] {
  const lines = [
    run.summary ? `Summary: ${run.summary}` : null,
    run.decision ? `Decision: ${run.decision}` : null,
    run.currentStep ? `Current step: ${run.currentStep}` : null,
    run.sourcePath ? `Source log: ${run.sourcePath}` : null,
    run.statePath ? `State path: ${run.statePath}` : null,
    run.logUrl ? `Kody log URL: ${run.logUrl}` : null,
    run.githubRunUrl ? `GitHub run URL: ${run.githubRunUrl}` : null,
  ];
  return lines.filter((line): line is string => line !== null);
}

export type FormattedRunEvidenceLine = {
  raw: string;
  label: string | null;
  value: string;
  tone: "field" | "raw" | "plain";
};

export type RunEvidenceViewTarget = {
  href: string;
  external: boolean;
  label: string;
};

type RunEvidenceViewContext = {
  currentRepo: RepoRef | null;
  stateRepo: RepoRef | null;
};

const FILE_REFERENCE_RE =
  /\b[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@()[\]-]+)+\.(?:mdx?|jsonl?|log|txt|ya?ml|tsx?|jsx?|css|scss)\b/i;

export function formatRunEvidenceLine(line: string): FormattedRunEvidenceLine {
  const splitAt = line.indexOf(": ");
  if (splitAt < 0) {
    return { raw: line, label: null, value: line, tone: "plain" };
  }
  const label = line.slice(0, splitAt).trim();
  const value = line.slice(splitAt + 2);
  const tone =
    /^Raw\b/i.test(label) || value.length > 180 || /[{\[]/.test(value)
      ? "raw"
      : "field";
  return { raw: line, label, value, tone };
}

function encodePath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function parseGitHubRepoUrl(value: string | null | undefined): RepoRef | null {
  const input = (value ?? "").trim() || DEFAULT_KODY_STORE_REPO_URL;
  const match = input.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

function firstReference(
  value: string,
): { kind: "url" | "path"; value: string } | null {
  const url = value.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0];
  if (url) return { kind: "url", value: url.replace(/[.,;]+$/g, "") };
  const path = value.match(FILE_REFERENCE_RE)?.[0];
  return path ? { kind: "path", value: path } : null;
}

function isStateEvidence(
  formatted: FormattedRunEvidenceLine,
  path: string,
  context: RunEvidenceViewContext,
): boolean {
  const label = formatted.label?.toLowerCase() ?? "";
  if (
    label === "report file" ||
    label === "source log" ||
    label === "state path" ||
    label === "raw workflow line"
  ) {
    return true;
  }
  if (
    context.stateRepo &&
    formatted.value.includes(
      `${context.stateRepo.owner}/${context.stateRepo.repo}`,
    )
  ) {
    return true;
  }
  return Boolean(
    context.currentRepo && path.startsWith(`${context.currentRepo.repo}/`),
  );
}

function stateEvidencePath(
  path: string,
  context: RunEvidenceViewContext,
): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (
    context.currentRepo &&
    normalized.startsWith(`${context.currentRepo.repo}/`)
  ) {
    return normalized.slice(context.currentRepo.repo.length + 1);
  }
  return normalized;
}

export function runEvidenceViewTarget(
  line: string,
  context: RunEvidenceViewContext,
): RunEvidenceViewTarget | null {
  const formatted = formatRunEvidenceLine(line);
  const reference = firstReference(formatted.value);
  if (!reference) return null;
  if (reference.kind === "url") {
    return {
      href: reference.value,
      external: true,
      label: "Open reference",
    };
  }

  const path = reference.value.replace(/^\/+|\/+$/g, "");
  if (!path) return null;
  if (isStateEvidence(formatted, path, context)) {
    return {
      href: `/state-files/${encodePath(stateEvidencePath(path, context))}`,
      external: false,
      label: "View state file",
    };
  }

  return {
    href: `/files/${encodePath(path)}`,
    external: false,
    label: "View file",
  };
}

export function operatorHappenedLines(
  run: AgencyRunSummary,
  events: Record<string, unknown>[],
  workflowSummary: string | null,
  workflowLines: string[],
): string[] {
  if (workflowLines.length > 0) return workflowLines;
  if (
    !workflowSummary &&
    (dispatchTarget(run.summary) ?? dispatchTarget(run.decision))
  ) {
    return operatorRunFactLines(run);
  }
  return [operatorHappened(run, events, workflowSummary)];
}

export function shouldWaitForRunStory(
  run: AgencyRunSummary,
  hasDetailData: boolean,
  isFetching: boolean,
): boolean {
  return (
    isFetching && !hasDetailData && Boolean(run.sourcePath || run.githubRunId)
  );
}

function operatorNext(
  run: AgencyRunSummary,
  events: Record<string, unknown>[],
  workflowSummary: string | null,
): string {
  const latest = events.at(-1) ?? null;
  const latestReason =
    eventDecisionSummary(latest) ?? eventResultSummary(latest);
  if (run.status === "running") return "The run is still executing.";
  if (
    workflowSummary &&
    /already tracks|already exists|existing tracking issue|avoid duplicate|no duplicate|no new issue|fix is already in flight/i.test(
      workflowSummary,
    )
  ) {
    return "Existing work is already tracking this.";
  }
  if (run.status === "waiting") {
    if (run.summary?.startsWith("waiting on goal ")) return run.summary;
    return "Waiting for the dispatched work to report back.";
  }
  if (run.status === "blocked")
    return latestReason ?? "Waiting for a blocker to be cleared.";
  if (run.status === "failed")
    return latestReason ?? "Open the run log to inspect the failure.";
  if (run.status === "success") return "No follow-up is needed from this run.";
  if (run.status === "stuck")
    return "Needs attention because no progress was reported.";
  if (run.status === "cancelled") return "This run stopped before finishing.";
  return latestReason ?? "No next action was recorded.";
}

function RunEvidenceLine({
  line,
  viewTarget,
}: {
  line: string;
  viewTarget: RunEvidenceViewTarget | null;
}) {
  const formatted = formatRunEvidenceLine(line);
  const target = viewTarget;
  const viewLink = target ? (
    <a
      href={target.href}
      target={target.external ? "_blank" : undefined}
      rel={target.external ? "noreferrer" : undefined}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/[0.08] text-white/45 hover:bg-white/[0.05] hover:text-white"
      title={target.label}
      aria-label={target.label}
    >
      <Eye className="h-3.5 w-3.5" />
    </a>
  ) : null;
  if (!formatted.label) {
    return (
      <li
        className="flex items-start justify-between gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-white/60"
        data-raw-evidence={formatted.raw}
      >
        <span className="min-w-0 break-words">{formatted.value}</span>
        {viewLink}
      </li>
    );
  }
  return (
    <li
      className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-2"
      data-raw-evidence={formatted.raw}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[10px] uppercase tracking-wide text-white/35">
          {formatted.label}
        </div>
        {viewLink}
      </div>
      {formatted.tone === "raw" ? (
        <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1.5 font-mono text-[11px] leading-5 text-white/65">
          {formatted.value}
        </pre>
      ) : (
        <div className="mt-0.5 break-words text-xs leading-5 text-white/70">
          {formatted.value}
        </div>
      )}
    </li>
  );
}

function RunDiagnosisPanel({ diagnosis }: { diagnosis: AgencyRunDiagnosis }) {
  return (
    <section className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-white/35">
            {diagnosis.pointLabel}
          </div>
          <div className="mt-1 break-words font-mono text-base font-semibold leading-6 text-white/90">
            {diagnosis.stoppedAt}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-white/35">
            Why
          </div>
          <div className="mt-1 text-sm font-medium leading-5 text-white/85">
            {diagnosis.why}
          </div>
        </div>
        <span className="inline-flex w-fit shrink-0 rounded border border-white/[0.1] bg-black/20 px-2 py-1 text-[10px] uppercase tracking-wide text-white/60">
          {diagnosis.status}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <div className="text-white/35">Last observed</div>
          <div className="break-words text-white/75">
            {diagnosis.lastObserved}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-white/35">Expected next event</div>
          <div className="break-words text-white/75">
            {diagnosis.expectedNextEvent}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-white/35">Missing evidence</div>
          <div className="break-words text-white/75">
            {diagnosis.missingEvidence.length
              ? diagnosis.missingEvidence.join(" ")
              : "Nothing obvious."}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-white/35">Owner</div>
          <div className="break-words text-white/75">{diagnosis.owner}</div>
        </div>
      </div>
      <div className="mt-3 border-t border-white/[0.06] pt-2">
        <div className="text-white/35">Next action</div>
        <div className="mt-0.5 text-sm leading-5 text-white/80">
          {diagnosis.nextAction}
        </div>
      </div>
    </section>
  );
}

function RunStoryLoadingPanel() {
  return (
    <section className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm leading-5 text-white/65">
      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
      Loading run detail...
    </section>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: AgencyRunSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const scopedHref = useRepoScopedHref();
  const { auth } = useAuth();
  const detail = useAgencyRunDetail(
    expanded ? run.sourcePath : null,
    expanded ? run.githubRunId : null,
  );
  const rawEvents = detail.data?.events ?? [];
  const workflowSummary = detail.data?.workflowLog?.summary ?? null;
  const workflowLines = detail.data?.workflowLog?.lines ?? [];
  const evidenceLines = [
    ...(detail.data?.workflowLog?.evidenceLines ?? []),
    ...rawRunEvidenceLines(run),
  ];
  const evidenceViewContext: RunEvidenceViewContext = {
    currentRepo: auth ? { owner: auth.owner, repo: auth.repo } : null,
    stateRepo: parseGitHubRepoUrl(auth?.storeRepoUrl),
  };
  const events = rawEvents.slice(-4).reverse();
  const waitingForRunStory = shouldWaitForRunStory(
    run,
    Boolean(detail.data),
    detail.isFetching,
  );
  const happened = waitingForRunStory
    ? []
    : operatorHappenedLines(run, rawEvents, workflowSummary, workflowLines);
  const diagnosis = waitingForRunStory
    ? null
    : agencyRunDiagnosis(run, rawEvents, workflowLines);
  const next = waitingForRunStory
    ? null
    : operatorNext(run, rawEvents, workflowSummary);
  return (
    <article className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-3 px-3 py-3 text-left text-sm hover:bg-white/[0.03] md:grid-cols-[140px_minmax(0,1.4fr)_minmax(0,1fr)_140px_90px]"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
              statusTone(run.status),
            )}
          >
            <StatusIcon status={run.status} />
            {run.status}
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-white/85">{run.title}</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-2 text-xs text-white/40">
            <span>{run.origin}</span>
            {(run.modelName ?? run.model) ? (
              <span>{run.modelName ?? run.model}</span>
            ) : null}
            {run.kodyRunId ? (
              <span className="font-mono">{run.kodyRunId}</span>
            ) : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-white/70">
            {run.currentStep ?? run.summary ?? "-"}
          </div>
          {run.decision ? (
            <div className="mt-0.5 truncate text-xs text-white/40">
              {run.decision}
            </div>
          ) : null}
        </div>
        <div className="text-xs text-white/50">{formatTime(run.startedAt)}</div>
        <div className="text-xs text-white/50">
          {formatDuration(run.durationMs)}
        </div>
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-white/[0.05] bg-black/20 px-3 py-3 text-xs">
          {diagnosis ? (
            <RunDiagnosisPanel diagnosis={diagnosis} />
          ) : (
            <RunStoryLoadingPanel />
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-white/35">What happened</div>
              {waitingForRunStory ? (
                <div className="text-sm leading-5 text-white/55">
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  Loading run story...
                </div>
              ) : happened.length > 1 ? (
                <ul className="space-y-1 text-sm leading-5 text-white/80">
                  {happened.map((line, index) => (
                    <li key={`${line}-${index}`} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/35" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm leading-5 text-white/80">
                  {happened[0]}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <div className="text-white/35">Next state</div>
              <div className="text-sm leading-5 text-white/80">
                {next ?? "Loading run state..."}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={scopedHref(kindHref(run))}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 font-mono text-white/60 hover:bg-white/[0.05] hover:text-white"
            >
              {run.targetLabel}
            </a>
            {run.githubRunUrl ? (
              <a
                href={run.githubRunUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 text-white/55 hover:bg-white/[0.05] hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
                GitHub run
              </a>
            ) : null}
            {run.logUrl ? (
              <a
                href={run.logUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 text-white/55 hover:bg-white/[0.05] hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
                Kody log
              </a>
            ) : null}
            {run.statePath ? (
              <span className="font-mono text-white/35">
                State {run.statePath}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 border-t border-white/[0.05] pt-3 md:grid-cols-4">
            <div className="space-y-1">
              <div className="text-white/35">Updated</div>
              <div className="text-white/70">{formatTime(run.updatedAt)}</div>
            </div>
            <div className="space-y-1">
              <div className="text-white/35">Runtime</div>
              <div className="truncate text-white/70">
                {runtimeLabel(run) ?? "-"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-white/35">Model</div>
              <div className="truncate text-white/70">
                {run.model ?? run.modelName ?? "Unknown"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-white/35">Actor</div>
              <div className="truncate text-white/70">
                {run.actor ?? "Unknown"}
              </div>
            </div>
          </div>

          <details className="border-t border-white/[0.05] pt-3">
            <summary className="cursor-pointer text-white/45 hover:text-white/70">
              Raw event timeline
            </summary>
            {detail.isFetching ? (
              <div className="mt-2 text-white/45">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Loading events...
              </div>
            ) : events.length ? (
              <div className="mt-2 divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.06]">
                {events.map((event, index) => {
                  const summary = eventSummary(event);
                  return (
                    <div
                      key={`${summary.time}-${summary.event}-${index}`}
                      className="grid gap-2 px-2 py-2 md:grid-cols-[150px_1fr_90px]"
                    >
                      <div className="text-white/40">
                        {formatTime(summary.time)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-white/75">
                          {summary.event}
                        </div>
                        {summary.reason ? (
                          <div className="mt-0.5 truncate text-white/40">
                            {summary.reason}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-white/45">
                        {summary.status ?? "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : run.sourcePath ? (
              <div className="mt-2 text-white/45">No events found</div>
            ) : (
              <div className="mt-2 text-white/45">No source log</div>
            )}
          </details>

          {evidenceLines.length > 0 ? (
            <details className="border-t border-white/[0.05] pt-3">
              <summary className="cursor-pointer text-white/45 hover:text-white/70">
                Run evidence
              </summary>
              <ul className="mt-2 space-y-1 text-xs leading-5">
                {evidenceLines.map((line, index) => (
                  <RunEvidenceLine
                    key={`${line}-${index}`}
                    line={line}
                    viewTarget={(() => {
                      const target = runEvidenceViewTarget(
                        line,
                        evidenceViewContext,
                      );
                      if (!target || target.external) return target;
                      return { ...target, href: scopedHref(target.href) };
                    })()}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-black/20 px-4 py-8 text-center">
      <Route className="h-7 w-7 text-white/25" />
      <div className="text-sm font-medium text-white/75">No {label} runs</div>
      <div className="max-w-sm text-xs text-white/40">
        This page only shows Kody-native runs recorded in the state repo.
      </div>
    </div>
  );
}

export function AgencyRunsPage() {
  const { data, isLoading, error, refetch, isFetching } = useAgencyRuns();
  const [selectedKind, setSelectedKind] = useState<AgencyRunKind>("loop");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (data?.runs ?? []).filter((run) => run.kind === selectedKind),
    [data?.runs, selectedKind],
  );
  const activeTab = TABS.find((tab) => tab.kind === selectedKind) ?? TABS[0];

  return (
    <PageShell
      title="Agency Runs"
      subtitle="Kody runs for goals, loops, and workflows"
      icon={Route}
      backHref={null}
      width="full"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="h-8 w-8 px-0"
          title="Refresh runs"
          aria-label="Refresh runs"
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      }
      contentClassName="space-y-4"
    >
      <div className="grid gap-2 md:grid-cols-3">
        {TABS.map((tab) => {
          const active = selectedKind === tab.kind;
          const count = data?.counts[tab.kind] ?? 0;
          return (
            <button
              key={tab.kind}
              type="button"
              onClick={() => {
                setSelectedKind(tab.kind);
                setExpandedId(null);
              }}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-emerald-400/40 bg-emerald-400/10 text-white"
                  : "border-white/[0.08] bg-black/20 text-white/55 hover:bg-white/[0.04]",
              )}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div className="mt-1 font-mono text-2xl tabular-nums">
                {count}
              </div>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-200">
          {error instanceof Error ? error.message : "Failed to load runs"}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-white/[0.08] bg-black/20 px-3 py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
          Loading agency runs...
        </div>
      ) : filtered.length ? (
        <section className="overflow-hidden rounded-md border border-white/[0.08] bg-black/20">
          <header className="grid gap-3 border-b border-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-wide text-white/35 md:grid-cols-[140px_minmax(0,1.4fr)_minmax(0,1fr)_140px_90px]">
            <div>Status</div>
            <div>{activeTab.label.slice(0, -1)}</div>
            <div>Step</div>
            <div>Started</div>
            <div>Duration</div>
          </header>
          {filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() =>
                setExpandedId((current) => (current === run.id ? null : run.id))
              }
            />
          ))}
        </section>
      ) : (
        <EmptyPanel label={activeTab.label.toLowerCase()} />
      )}
    </PageShell>
  );
}
