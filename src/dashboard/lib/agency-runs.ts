/**
 * @fileType utility
 * @domain kody
 * @pattern agency-runs
 * @ai-summary Reads the engine-authored Kody run index for goals, loops, and
 *   workflows without scanning per-goal logs.
 */
import type { Octokit } from "@octokit/rest";

import { readStateText } from "./state-repo";

export type AgencyRunKind = "goal" | "loop" | "workflow";
export type AgencyRunOrigin = "manual" | "scheduled" | "event" | "local";
export type AgencyRunStatus =
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "stuck"
  | "blocked"
  | "cancelled"
  | "recorded";

type GitHubWorkflowRun = {
  id?: number | string | null;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
};

type ManagedGoalStatusValue = "inactive" | "active" | "paused" | "done";

type ManagedGoalStateLite = {
  state: ManagedGoalStatusValue;
  stage: string | null;
  updatedAt: string | null;
  blockers: string[];
  facts: Record<string, unknown>;
};

export interface AgencyRunSummary {
  id: string;
  kind: AgencyRunKind;
  targetId: string;
  targetLabel: string;
  targetModel: string | null;
  origin: AgencyRunOrigin;
  status: AgencyRunStatus;
  title: string;
  summary: string | null;
  currentStep: string | null;
  decision: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  kodyRunId: string | null;
  githubRunId: string | null;
  githubRunUrl: string | null;
  logUrl: string | null;
  statePath: string | null;
  sourcePath: string | null;
  action: string | null;
  capability: string | null;
  workflow: string | null;
  executable: string | null;
  agent: string | null;
  model: string | null;
  modelProvider: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
  actor: string | null;
}

export interface AgencyRunsPayload {
  runs: AgencyRunSummary[];
  counts: Record<AgencyRunKind, number>;
  computedAt: string;
  source: {
    path: "runs/index.json";
    updatedAt: string | null;
    etag: string | null;
  };
}

export interface AgencyRunDetailPayload {
  path: string;
  htmlUrl: string | null;
  events: Array<Record<string, unknown>>;
  workflowLog: AgencyRunWorkflowLogInsight | null;
  computedAt: string;
}

export interface AgencyRunWorkflowLogInsight {
  jobId: string;
  jobName: string | null;
  status: "completed" | "failed" | "recorded";
  summary: string | null;
  lines: string[];
}

interface RunIndexRow {
  version?: unknown;
  id?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  subjectLabel?: unknown;
  subjectModel?: unknown;
  status?: unknown;
  title?: unknown;
  summary?: unknown;
  currentStep?: unknown;
  decision?: unknown;
  startedAt?: unknown;
  updatedAt?: unknown;
  kodyRunId?: unknown;
  githubRunId?: unknown;
  githubRunUrl?: unknown;
  triggerMode?: unknown;
  sourcePath?: unknown;
  detailUrl?: unknown;
  statePath?: unknown;
  action?: unknown;
  capability?: unknown;
  workflow?: unknown;
  executable?: unknown;
  agent?: unknown;
  model?: unknown;
  modelProvider?: unknown;
  modelName?: unknown;
  reasoningEffort?: unknown;
  actor?: unknown;
}

interface RunIndexFile {
  updatedAt: string | null;
  runs: RunIndexRow[];
}

const RUN_INDEX_PATH = "runs/index.json";
const DISPATCH_STUCK_MS = 20 * 60_000;
const readCache = new Map<
  string,
  { etag: string | undefined; json: string; path: string }
>();

function cacheKey(owner: string, repo: string) {
  return `${owner}/${repo}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function kindValue(value: unknown): AgencyRunKind | null {
  return value === "goal" || value === "loop" || value === "workflow"
    ? value
    : null;
}

function statusValue(value: unknown): AgencyRunStatus {
  if (
    value === "running" ||
    value === "waiting" ||
    value === "success" ||
    value === "failed" ||
    value === "stuck" ||
    value === "blocked" ||
    value === "cancelled" ||
    value === "recorded"
  ) {
    return value;
  }
  return "recorded";
}

function managedGoalPath(goalId: string): string | null {
  if (!goalId || /[\\/]/.test(goalId) || goalId.includes("..")) return null;
  return `todos/${goalId}.json`;
}

function parseManagedGoalState(json: string): ManagedGoalStateLite | null {
  const parsed = asRecord(JSON.parse(json));
  const state = parsed?.state;
  if (
    state !== "inactive" &&
    state !== "active" &&
    state !== "paused" &&
    state !== "done"
  ) {
    return null;
  }
  const facts = asRecord(parsed?.facts) ?? {};
  return {
    state,
    stage: stringValue(parsed?.stage),
    updatedAt: stringValue(parsed?.updatedAt),
    blockers: Array.isArray(parsed?.blockers)
      ? parsed.blockers.filter((item): item is string => typeof item === "string")
      : [],
    facts,
  };
}

function dispatchGoalId(run: AgencyRunSummary): string | null {
  const text = [run.summary, run.decision, run.currentStep].filter(Boolean).join("\n");
  const match = text.match(/\bdispatch goal ([A-Za-z0-9_.-]+)/i);
  if (match?.[1]) return match[1];
  if (run.kind === "goal" && /\bdispatchWorkflow\b/i.test(text)) return run.targetId;
  return null;
}

function pendingEvidence(goal: ManagedGoalStateLite): string | null {
  const pending = goal.facts.pendingEvidence;
  if (typeof pending === "string" && pending.trim()) return pending.trim();
  return null;
}

function statusFromManagedGoal(goal: ManagedGoalStateLite, nowMs = Date.now()): AgencyRunStatus {
  if (goal.state === "done") return "success";
  if (goal.blockers.length > 0) return "blocked";
  if (goal.state === "paused" || goal.state === "inactive") return "waiting";
  const updatedAt = goal.updatedAt ? Date.parse(goal.updatedAt) : NaN;
  if (Number.isFinite(updatedAt) && nowMs - updatedAt > DISPATCH_STUCK_MS) return "stuck";
  return "running";
}

function stepFromManagedGoal(goalId: string, goal: ManagedGoalStateLite): string {
  const stage = goal.stage ?? goal.state;
  const evidence = pendingEvidence(goal);
  return evidence ? `${goalId}: ${stage} / ${evidence}` : `${goalId}: ${stage}`;
}

function statusFromGitHubRun(run: GitHubWorkflowRun): AgencyRunStatus | null {
  if (run.status === "queued" || run.status === "requested" || run.status === "pending") {
    return "running";
  }
  if (run.status === "waiting") return "waiting";
  if (run.status === "in_progress") return "running";
  if (run.status !== "completed") return null;

  if (run.conclusion === "success") return "success";
  if (run.conclusion === "cancelled" || run.conclusion === "skipped") return "cancelled";
  if (run.conclusion === "neutral") return "recorded";
  if (
    run.conclusion === "failure" ||
    run.conclusion === "timed_out" ||
    run.conclusion === "startup_failure" ||
    run.conclusion === "action_required"
  ) {
    return "failed";
  }
  return null;
}

function originValue(value: unknown): AgencyRunOrigin {
  if (
    value === "manual" ||
    value === "scheduled" ||
    value === "event" ||
    value === "local"
  ) {
    return value;
  }
  return "event";
}

function parseRunIndex(json: string): RunIndexFile {
  const parsed = asRecord(JSON.parse(json));
  const rows = Array.isArray(parsed?.runs)
    ? parsed.runs.filter((row): row is RunIndexRow => asRecord(row) !== null)
    : [];
  return {
    updatedAt: stringValue(parsed?.updatedAt),
    runs: rows,
  };
}

function parseJsonl(content: string): Array<Record<string, unknown>> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return asRecord(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function cleanLogLine(value: string): string {
  return stripAnsi(value)
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/, "")
    .replace(/^##\[[^\]]+\]/, "")
    .trim();
}

function collectSummaryLines(lines: string[]): string[] {
  const start = lines.findIndex((line) => line === "PR_SUMMARY:");
  if (start < 0) return [];
  const summary: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line || line.startsWith("===") || line.startsWith("##[")) break;
    summary.push(line.replace(/^-\s*/, ""));
    if (summary.length >= 4) break;
  }
  return summary;
}

function summarizeWorkflowLog(
  jobId: string,
  jobName: string | null,
  raw: string,
): AgencyRunWorkflowLogInsight {
  const lines = raw
    .split(/\r?\n/)
    .map(cleanLogLine)
    .filter(Boolean);
  const failed = lines.find((line) => line.startsWith("PR_URL=FAILED:"));
  const summaryLines = collectSummaryLines(lines);
  const usefulLine =
    [...lines]
      .reverse()
      .find((line) =>
        /already tracks|already exists|no duplicate|Dev CI|CI is red|DONE/i.test(
          line,
        ),
      ) ?? null;
  const summary =
    summaryLines.length > 0
      ? summaryLines.join(" ")
      : failed?.replace(/^PR_URL=FAILED:\s*/, "") ?? usefulLine;

  return {
    jobId,
    jobName,
    status: failed ? "failed" : lines.includes("DONE") ? "completed" : "recorded",
    summary,
    lines: summaryLines.length > 0 ? summaryLines : usefulLine ? [usefulLine] : [],
  };
}

async function readWorkflowLogInsight({
  octokit,
  owner,
  repo,
  githubRunId,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  githubRunId: string | null | undefined;
}): Promise<AgencyRunWorkflowLogInsight | null> {
  if (!githubRunId || !/^\d+$/.test(githubRunId)) return null;
  try {
    const jobsResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      {
        owner,
        repo,
        run_id: Number(githubRunId),
        per_page: 20,
      },
    );
    const jobsData = jobsResponse.data as {
      jobs?: Array<{ id?: number | string | null; name?: string | null }>;
    };
    const job =
      jobsData.jobs?.find((item) => item.name === "run") ?? jobsData.jobs?.[0];
    if (!job?.id) return null;

    const logsResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
      {
        owner,
        repo,
        job_id: Number(job.id),
      },
    );
    const data = logsResponse.data;
    const raw =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : "";
    if (!raw) return null;
    return summarizeWorkflowLog(String(job.id), stringValue(job.name), raw);
  } catch {
    return null;
  }
}

function assertAllowedDetailPath(path: string): void {
  if (
    path.includes("..") ||
    path.startsWith("/") ||
    !path.startsWith("logs/goals/") ||
    !path.endsWith(".jsonl")
  ) {
    throw new Error("unsupported_run_detail_path");
  }
}

function durationMs(startedAt: string | null, updatedAt: string | null) {
  if (!startedAt || !updatedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return end - start;
}

function sortTime(run: AgencyRunSummary): number {
  const raw = run.updatedAt ?? run.startedAt ?? "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function rowToAgencyRun(row: RunIndexRow): AgencyRunSummary | null {
  const kind = kindValue(row.subjectType);
  const targetId = stringValue(row.subjectId);
  const id = stringValue(row.id);
  if (!kind || !targetId || !id) return null;

  const startedAt = stringValue(row.startedAt);
  const updatedAt = stringValue(row.updatedAt);
  const targetLabel = stringValue(row.subjectLabel) ?? targetId;

  return {
    id,
    kind,
    targetId,
    targetLabel,
    targetModel: stringValue(row.subjectModel),
    origin: originValue(row.triggerMode),
    status: statusValue(row.status),
    title: stringValue(row.title) ?? targetLabel,
    summary: stringValue(row.summary),
    currentStep: stringValue(row.currentStep),
    decision: stringValue(row.decision),
    startedAt,
    updatedAt,
    durationMs: durationMs(startedAt, updatedAt),
    kodyRunId: stringValue(row.kodyRunId),
    githubRunId: stringValue(row.githubRunId),
    githubRunUrl: stringValue(row.githubRunUrl),
    logUrl: stringValue(row.detailUrl),
    statePath: stringValue(row.statePath),
    sourcePath: stringValue(row.sourcePath),
    action: stringValue(row.action),
    capability: stringValue(row.capability),
    workflow: stringValue(row.workflow),
    executable: stringValue(row.executable),
    agent: stringValue(row.agent),
    model: stringValue(row.model),
    modelProvider: stringValue(row.modelProvider),
    modelName: stringValue(row.modelName),
    reasoningEffort: stringValue(row.reasoningEffort),
    actor: stringValue(row.actor),
  };
}

async function applyGitHubRunOverlay({
  octokit,
  owner,
  repo,
  runs,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  runs: AgencyRunSummary[];
}): Promise<AgencyRunSummary[]> {
  const ids = new Set(runs.map((run) => run.githubRunId).filter(Boolean));
  if (!ids.size) return runs;

  let response: Awaited<ReturnType<Octokit["actions"]["listWorkflowRunsForRepo"]>>;
  try {
    response = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: 100,
    });
  } catch {
    return runs;
  }
  const byId = new Map<string, GitHubWorkflowRun>();
  for (const run of response.data.workflow_runs) {
    if (run.id !== undefined && run.id !== null) byId.set(String(run.id), run);
  }

  return runs.map((run) => {
    if (!run.githubRunId) return run;
    const githubRun = byId.get(run.githubRunId);
    if (!githubRun) return run;
    const status = statusFromGitHubRun(githubRun);
    if (!status) return run;
    return {
      ...run,
      status,
      githubRunUrl: stringValue(githubRun.html_url) ?? run.githubRunUrl,
    };
  });
}

async function applyDispatchTargetOverlay({
  octokit,
  owner,
  repo,
  runs,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  runs: AgencyRunSummary[];
}): Promise<AgencyRunSummary[]> {
  const targetIds = new Map<string, string>();
  for (const run of runs) {
    const targetId = dispatchGoalId(run);
    if (targetId) targetIds.set(run.id, targetId);
  }
  if (!targetIds.size) return runs;

  const goals = new Map<string, ManagedGoalStateLite>();
  await Promise.all(
    Array.from(new Set(targetIds.values())).map(async (goalId) => {
      const path = managedGoalPath(goalId);
      if (!path) return;
      try {
        const file = await readStateText(octokit, owner, repo, path);
        if (!file) return;
        const goal = parseManagedGoalState(file.content);
        if (goal) goals.set(goalId, goal);
      } catch {
        // Keep the run index usable when a target goal file disappeared.
      }
    }),
  );
  if (!goals.size) return runs;

  return runs.map((run) => {
    const targetId = targetIds.get(run.id);
    const goal = targetId ? goals.get(targetId) : null;
    if (!targetId || !goal) return run;
    const status = statusFromManagedGoal(goal);
    return {
      ...run,
      status,
      currentStep: stepFromManagedGoal(targetId, goal),
      summary:
        status === "stuck"
          ? `stuck waiting on goal ${targetId}`
          : `waiting on goal ${targetId}`,
    };
  });
}

async function readRunIndexFile({
  octokit,
  owner,
  repo,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<{ index: RunIndexFile; etag: string | null }> {
  const key = cacheKey(owner, repo);
  const cached = readCache.get(key);
  try {
    const file = await readStateText(octokit, owner, repo, RUN_INDEX_PATH, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (!file) return { index: { updatedAt: null, runs: [] }, etag: null };
    readCache.set(key, {
      etag: file.etag,
      json: file.content,
      path: file.path,
    });
    return { index: parseRunIndex(file.content), etag: file.etag ?? null };
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      return { index: parseRunIndex(cached.json), etag: cached.etag ?? null };
    }
    if (status === 404) return { index: { updatedAt: null, runs: [] }, etag: null };
    throw error;
  }
}

export async function listAgencyRuns({
  octokit,
  owner,
  repo,
  limit = 50,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  limit?: number;
}): Promise<AgencyRunsPayload> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { index, etag } = await readRunIndexFile({ octokit, owner, repo });
  const indexedRuns = index.runs
    .map(rowToAgencyRun)
    .filter((run): run is AgencyRunSummary => run !== null)
    .sort((a, b) => sortTime(b) - sortTime(a))
    .slice(0, boundedLimit);
  const runsWithGitHub = await applyGitHubRunOverlay({
    octokit,
    owner,
    repo,
    runs: indexedRuns,
  });
  const runs = await applyDispatchTargetOverlay({
    octokit,
    owner,
    repo,
    runs: runsWithGitHub,
  });

  return {
    runs,
    counts: {
      goal: runs.filter((run) => run.kind === "goal").length,
      loop: runs.filter((run) => run.kind === "loop").length,
      workflow: runs.filter((run) => run.kind === "workflow").length,
    },
    computedAt: new Date().toISOString(),
    source: {
      path: RUN_INDEX_PATH,
      updatedAt: index.updatedAt,
      etag,
    },
  };
}

export async function readAgencyRunDetail({
  octokit,
  owner,
  repo,
  sourcePath,
  githubRunId,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sourcePath: string;
  githubRunId?: string | null;
}): Promise<AgencyRunDetailPayload> {
  assertAllowedDetailPath(sourcePath);
  const [file, workflowLog] = await Promise.all([
    readStateText(octokit, owner, repo, sourcePath),
    readWorkflowLogInsight({ octokit, owner, repo, githubRunId }),
  ]);
  return {
    path: sourcePath,
    htmlUrl: file?.htmlUrl ?? null,
    events: parseJsonl(file?.content ?? ""),
    workflowLog,
    computedAt: new Date().toISOString(),
  };
}
