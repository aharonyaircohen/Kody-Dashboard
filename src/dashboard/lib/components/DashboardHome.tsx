/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-overview
 * @ai-summary The operations overview rendered at `/` (the "Dashboard" view).
 *   An at-a-glance control panel built top-to-bottom around "what needs me,
 *   what's broken": an attention row (reports + failures), a task
 *   pulse, capabilities health, latest reports, and engine health. Every section
 *   rides a hook the rest of the dashboard already polls, so it adds no new
 *   GitHub load — it just composes existing caches into one screen. `/` used
 *   to redirect to /tasks; it now lands here, with Tasks/Vibe one click away
 *   in the rail's "Views" group.
 */
"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  Inbox,
  Loader2,
  type LucideIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Target,
  X,
} from "lucide-react";

import { Card } from "@dashboard/ui/card";
import { Button } from "@dashboard/ui/button";
import { HappeningNow } from "./HappeningNow";
import { TriageStrip } from "./TriageStrip";
import { useKodyTasks } from "../hooks";
import { useReports } from "../hooks/useReports";
import { useDefaultBranchCI } from "../hooks/useDefaultBranchCI";
import { useHealth } from "../hooks/useHealth";
import { useMessageChannels } from "../hooks/useMessages";
import { useChannelsUnread } from "../hooks/useChannelsUnread";
import { useActivityLog } from "../hooks/useActivityLog";
import {
  useAcknowledgeHealthSignal,
  useCreateFixCITask,
  useRerunCIRun,
  useRetryTask,
} from "../hooks/useDashboardActions";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useManagedGoals } from "../hooks/useManagedGoals";
import { useAuth } from "../auth-context";
import { managedGoalModel, type ManagedGoalRecord } from "../managed-goals";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { CreateGoalDialog } from "./GoalControl";
import { RepoManager } from "./RepoManager";
import { RepoScopedLink } from "./RepoScopedLink";
import { cn } from "../utils";
import { autoDirProps } from "../text-direction";
import type { ColumnId, KodyTask } from "../types";
import type { HealthLevel } from "../health/types";
import type { DefaultBranchCI, Report } from "../api";
import { getStoredAuth } from "../api";
import type { ActionLogEntry } from "../activity/action-log";
import { repoScopedHref } from "../routes";

// ── helpers ───────────────────────────────────────────────────────────────

/** Compact "3m ago" / "2h ago" / "5d ago" from an ISO timestamp. */
function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const ACTIVE_COLUMNS: readonly ColumnId[] = [
  "building",
  "retrying",
  "gate-waiting",
];

function countBy(tasks: KodyTask[], cols: readonly ColumnId[]): number {
  return tasks.filter((t) => cols.includes(t.column)).length;
}

const LEVEL_TINT: Record<HealthLevel, string> = {
  ok: "text-emerald-300 bg-emerald-500/10",
  degraded: "text-amber-300 bg-amber-500/10",
  down: "text-rose-300 bg-rose-500/10",
};

// ── small building blocks ───────────────────────────────────────────────────

function SectionHeader({
  title,
  href,
  cta = "View all",
}: {
  title: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-label font-semibold uppercase tracking-wider text-muted-foreground/80">
        {title}
      </h2>
      {href && (
        <RepoScopedLink
          href={href}
          className="inline-flex items-center gap-1 text-body-xs text-muted-foreground hover:text-foreground"
        >
          {cta} <ArrowRight className="w-3 h-3" />
        </RepoScopedLink>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tint,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tint: string;
  href: string;
}) {
  return (
    <RepoScopedLink href={href} className="block">
      <Card className="h-full p-3 transition-colors hover:bg-white/[0.04]">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              tint,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-xl font-semibold leading-none tabular-nums">
              {value}
            </div>
            <div className="mt-1 truncate text-body-xs text-muted-foreground">
              {label}
            </div>
          </div>
        </div>
      </Card>
    </RepoScopedLink>
  );
}

/** A calm "nothing to do" state inside an attention card. */
function AllClear({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 py-2 text-body-sm text-muted-foreground">
      <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
      {message}
    </div>
  );
}

function DashboardHeader({
  tasks,
  tasksLoading,
  mainCi,
  mainCiLoading,
  updatedAt,
}: {
  tasks: KodyTask[];
  tasksLoading: boolean;
  mainCi?: DefaultBranchCI;
  mainCiLoading?: boolean;
  updatedAt?: number;
}) {
  const active = countBy(tasks, ACTIVE_COLUMNS);
  const review = countBy(tasks, ["review"]);
  const failing = countBy(tasks, ["failed"]);
  const updated = updatedAt ? timeAgo(new Date(updatedAt).toISOString()) : "";
  const ciState: DefaultBranchCI["state"] | "loading" = mainCi
    ? mainCi.state
    : mainCiLoading
      ? "loading"
      : "unknown";
  const ciStatus =
    ciState === "failure"
      ? {
          tone: "border-rose-400/20 bg-rose-500/10 text-rose-200",
          text: "CI failing",
        }
      : ciState === "pending"
        ? {
            tone: "border-sky-400/20 bg-sky-500/10 text-sky-200",
            text: "CI running",
          }
        : ciState === "success"
          ? {
              tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
              text: "CI green",
            }
          : ciState === "loading"
            ? {
                tone: "border-white/10 bg-white/[0.04] text-muted-foreground",
                text: "Checking CI",
              }
            : {
                tone: "border-white/10 bg-white/[0.04] text-muted-foreground",
                text: "CI unknown",
              };

  return (
    <header className="border-b border-white/[0.06] pb-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-lg font-semibold tracking-normal">Dashboard</h1>
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-md border px-2.5 text-body-xs font-medium",
              ciStatus.tone,
            )}
            title={mainCi ? `Main CI on ${mainCi.branch}` : "Main CI status"}
          >
            {ciStatus.text}
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
            <span className="tabular-nums text-amber-200">
              {tasksLoading ? "—" : active} active
            </span>
            <span className="tabular-nums text-sky-200">
              {tasksLoading ? "—" : review} in review
            </span>
            <span className="tabular-nums text-rose-200">
              {tasksLoading ? "—" : failing} failing
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-body-xs text-muted-foreground">
          {updated ? <span>Updated {updated}</span> : null}
          <RepoScopedLink
            href="/tasks"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-white/[0.08] px-2.5 hover:bg-white/[0.06] hover:text-foreground"
          >
            Open board <ArrowRight className="h-3 w-3" />
          </RepoScopedLink>
        </div>
      </div>
    </header>
  );
}

// ── attention cards ─────────────────────────────────────────────────────────

/**
 * "Needs you" — reports with review status or suggested actions. Stats, not a
 * scrolling list of items; the full reports live one click away on /reports.
 */
function NeedsYouCard() {
  const { data: reports = [], isLoading } = useReports();
  const needsReview = reports.filter(
    (r) =>
      r.reviewStatus === "action-needed" ||
      r.reviewStatus === "assigned" ||
      (r.suggestedActions ?? []).length > 0,
  );
  const actionNeeded = reports.filter(
    (r) => r.reviewStatus === "action-needed",
  ).length;
  const assigned = reports.filter((r) => r.reviewStatus === "assigned").length;
  const suggestedActions = reports.reduce(
    (sum, report) => sum + (report.suggestedActions ?? []).length,
    0,
  );

  const stats = [
    { label: "Reports", value: needsReview.length, tone: "text-sky-300" },
    { label: "Actions", value: suggestedActions, tone: "text-amber-300" },
    { label: "Assigned", value: assigned, tone: "text-violet-300" },
    { label: "Action needed", value: actionNeeded, tone: "text-rose-300" },
  ].filter((s) => s.value > 0);

  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-md",
              needsReview.length > 0
                ? "text-sky-300 bg-sky-500/10"
                : "text-emerald-300 bg-emerald-500/10",
            )}
          >
            <FileText className="w-4 h-4" />
          </span>
          <div>
            <div className="text-body-sm font-medium">Needs you</div>
            <div className="text-body-xs text-muted-foreground">
              {isLoading
                ? "Loading…"
                : `${needsReview.length} report${needsReview.length === 1 ? "" : "s"} need review`}
            </div>
          </div>
        </div>
        <RepoScopedLink
          href="/reports"
          className="inline-flex items-center gap-1 text-body-xs text-muted-foreground hover:text-foreground"
        >
          Reports <ArrowRight className="w-3 h-3" />
        </RepoScopedLink>
      </div>

      {!isLoading && needsReview.length === 0 ? (
        <AllClear message="No reports need review." />
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {stats.map((s) => (
            <RepoScopedLink
              key={s.label}
              href="/reports"
              className="flex items-baseline gap-1.5"
            >
              <span
                className={cn(
                  "text-lg font-semibold tabular-nums leading-none",
                  s.tone,
                )}
              >
                {s.value}
              </span>
              <span className="text-body-xs text-muted-foreground">
                {s.label}
              </span>
            </RepoScopedLink>
          ))}
        </div>
      )}
    </Card>
  );
}

/** "Failing now" — main-branch CI + failed tasks (with reason). */
function FailingCard({
  tasks,
  tasksLoading,
  ci,
}: {
  tasks: KodyTask[];
  tasksLoading: boolean;
  ci?: DefaultBranchCI;
}) {
  const { githubUser } = useGitHubIdentity();
  const { auth } = useAuth();
  const scopedHref = (href: string) =>
    auth ? repoScopedHref(auth, href) : href;
  const rerunCI = useRerunCIRun();
  const createFixCI = useCreateFixCITask();
  const retryTask = useRetryTask(githubUser?.login);
  const ciRed = ci?.state === "failure";
  const failed = tasks.filter((t) => t.column === "failed").slice(0, 5);
  const nothingWrong = !ciRed && failed.length === 0;

  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-md",
              nothingWrong
                ? "text-emerald-300 bg-emerald-500/10"
                : "text-rose-300 bg-rose-500/10",
            )}
          >
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div>
            <div className="text-body-sm font-medium">Failing</div>
            <div className="text-body-xs text-muted-foreground">
              CI &amp; failed tasks
            </div>
          </div>
        </div>
        <RepoScopedLink
          href={scopedHref("/tasks")}
          className="inline-flex items-center gap-1 text-body-xs text-muted-foreground hover:text-foreground"
        >
          Tasks <ArrowRight className="w-3 h-3" />
        </RepoScopedLink>
      </div>

      {tasksLoading ? (
        <p className="py-2 text-body-sm text-muted-foreground">Loading…</p>
      ) : nothingWrong ? (
        <AllClear message="Nothing failing right now." />
      ) : (
        <div className="space-y-1">
          {ciRed && ci?.latestRun && (
            <div className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.04]">
              <GitBranch className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              <a
                href={ci.latestRun.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-body-sm"
                title="Open the failing run on GitHub"
              >
                {ci.branch} CI red
                <span className="text-muted-foreground">
                  {" "}
                  — {ci.latestRun.name}
                </span>
              </a>
              <span className="shrink-0 tabular-nums text-body-xs text-muted-foreground">
                {timeAgo(ci.latestRun.updated_at)}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-body-xs"
                  disabled={rerunCI.isPending}
                  onClick={() => rerunCI.mutate(ci.latestRun!.id)}
                  title="Re-run the failing workflow"
                >
                  {rerunCI.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Re-run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-body-xs"
                  disabled={createFixCI.isPending}
                  onClick={() =>
                    createFixCI.mutate({
                      ci: ci!,
                      runId: ci.latestRun!.id,
                      runName: ci.latestRun!.name,
                      runUrl: ci.latestRun!.html_url,
                    })
                  }
                  title="Open a Kody task seeded with this failure"
                >
                  {createFixCI.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  Fix CI
                </Button>
              </div>
            </div>
          )}
          {failed.map((t) => (
            <div
              key={t.id}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.04]"
            >
              <RepoScopedLink
                href={scopedHref(`/${t.issueNumber}`)}
                className="flex items-start gap-2 min-w-0 flex-1"
              >
                <span className="mt-0.5 w-11 shrink-0 tabular-nums text-body-xs text-muted-foreground">
                  #{t.issueNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    {...autoDirProps}
                    className="truncate text-start text-body-sm"
                  >
                    {t.title}
                  </div>
                  {t.failureReason && (
                    <div className="truncate text-body-xs text-rose-300/80">
                      {t.failureReason}
                    </div>
                  )}
                </div>
              </RepoScopedLink>
              <div className="flex items-center gap-1 shrink-0">
                {t.workflowRun?.html_url && (
                  <a
                    href={t.workflowRun.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-white/[0.08] px-2.5 text-body-xs text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                    title="Open the workflow run logs"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Logs
                  </a>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-body-xs"
                  disabled={retryTask.isPending}
                  onClick={() => retryTask.mutate(t.issueNumber)}
                  title="Re-queue this task in the pipeline"
                >
                  {retryTask.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Retry
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── lower sections (Reports + Engine) ────────────────────────────────────────

function LatestReports() {
  const { data, isLoading } = useReports();
  const [issueFromReport, setIssueFromReport] = useState<Report | null>(null);
  const [goalFromReport, setGoalFromReport] = useState<Report | null>(null);
  const reports = [...(data ?? [])]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);

  return (
    <section>
      <SectionHeader title="Latest reports" href="/reports" cta="Reports" />
      {isLoading ? (
        <p className="text-body-sm text-muted-foreground">Loading reports…</p>
      ) : reports.length === 0 ? (
        <Card className="p-card-padding-sm text-body-sm text-muted-foreground">
          No reports yet — capability runs write them here.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {reports.map((r) => (
            <div
              key={r.slug}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <RepoScopedLink
                href={`/reports/${r.slug}`}
                className="flex items-center gap-3 min-w-0 flex-1"
              >
                <FileText className="w-4 h-4 text-sky-300 shrink-0" />
                <span className="flex-1 truncate text-body-sm">{r.title}</span>
                <span className="shrink-0 text-body-xs text-muted-foreground">
                  {timeAgo(r.updatedAt)}
                </span>
              </RepoScopedLink>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-body-xs"
                  onClick={() => setGoalFromReport(r)}
                  title="Plan a new mission from this report"
                >
                  <Target className="w-3 h-3 text-emerald-400" />
                  Plan mission
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1 bg-sky-600 px-2.5 text-body-xs text-white hover:bg-sky-700"
                  onClick={() => setIssueFromReport(r)}
                  title="Create a GitHub issue from this report"
                >
                  <GitPullRequest className="w-3 h-3" />
                  Issue
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <CreateTaskDialog
        open={!!issueFromReport}
        onClose={() => setIssueFromReport(null)}
        prefill={
          issueFromReport
            ? {
                title: `Address: ${issueFromReport.title}`,
                body:
                  `${sourceReportMarkdown(issueFromReport)}\n\n` +
                  `---\n\n${issueFromReport.body}`,
                labels: [`from-report:${issueFromReport.slug}`],
              }
            : undefined
        }
        onCreated={() => setIssueFromReport(null)}
      />
      <CreateGoalDialog
        open={!!goalFromReport}
        onClose={() => setGoalFromReport(null)}
        initial={
          goalFromReport
            ? {
                name: goalFromReport.title,
                description:
                  `${sourceReportMarkdown(goalFromReport)}\n\n` +
                  `---\n\n${goalFromReport.body}`,
              }
            : undefined
        }
        onCreated={() => setGoalFromReport(null)}
      />
    </section>
  );
}

function sourceReportMarkdown(report: Report): string {
  const path = report.path || `reports/${report.slug}.md`;
  return `Source report: [\`${path}\`](${report.htmlUrl})`;
}

function EngineHealth() {
  const { data, isLoading } = useHealth();
  const ack = useAcknowledgeHealthSignal();
  const level = data?.level ?? "ok";
  const problems = (data?.signals ?? [])
    .filter((s) => s.level !== "ok")
    .slice(0, 3);
  const ackedCount = problems.filter((s) => ack.isAcknowledged(s.id)).length;

  return (
    <section>
      <SectionHeader title="Engine health" href="/activity" cta="Activity" />
      <Card className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-md",
              LEVEL_TINT[level],
            )}
          >
            <Activity className="w-4 h-4" />
          </span>
          <div className="text-body-sm">
            {isLoading
              ? "Checking…"
              : level === "ok"
                ? "All systems healthy."
                : level === "degraded"
                  ? "Degraded — runs work but are at risk."
                  : "Down — runs are blocked."}
          </div>
        </div>
        {problems.length > 0 ? (
          <div className="space-y-1 border-t border-white/[0.06] pt-2">
            {problems.map((s) => {
              const isAcked = ack.isAcknowledged(s.id);
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-md",
                    isAcked && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "text-label uppercase tracking-wide px-2 py-1 rounded shrink-0 mt-0.5",
                      LEVEL_TINT[s.level],
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="text-body-xs text-muted-foreground flex-1">
                    {s.detail}
                  </span>
                  {isAcked ? (
                    <button
                      type="button"
                      onClick={() => ack.unacknowledge(s.id)}
                      className="text-body-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title="Restore this signal"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ack.acknowledge(s.id)}
                      className="text-body-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title="Acknowledge — mute this signal until the next state change"
                    >
                      Ack
                    </button>
                  )}
                </div>
              );
            })}
            {ackedCount > 0 ? (
              <div className="text-body-xs text-muted-foreground px-2 pt-1">
                {ackedCount} acknowledged — click the × to restore.
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}

// ── strategic & historical slices ────────────────────────────────────────────

function ModelsOverview() {
  const { data: models = [], isLoading } = useManagedGoals();
  const top = [...models]
    .sort((a, b) => managedModelTime(b) - managedModelTime(a))
    .slice(0, 4);
  const objectiveCount = models.filter(
    (model) => managedGoalModel(model) === "agentGoal",
  ).length;
  const routineCount = models.filter(
    (model) => managedGoalModel(model) === "agentLoop",
  ).length;

  return (
    <section>
      <SectionHeader
        title="AgentGoals / agentLoops"
        href="/agent-goals"
        cta="Open"
      />
      {isLoading ? (
        <p className="text-body-sm text-muted-foreground">Loading models...</p>
      ) : models.length === 0 ? (
        <Card className="p-3 text-body-sm text-muted-foreground">
          No agentGoals or agentLoops yet.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-white/[0.04] border-b border-white/[0.04] text-body-xs">
            <RepoScopedLink
              href="/agent-goals"
              className="flex items-center justify-between px-3 py-2.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <span>AgentGoals</span>
              <span className="font-mono text-white/70">{objectiveCount}</span>
            </RepoScopedLink>
            <RepoScopedLink
              href="/agent-loops"
              className="flex items-center justify-between px-3 py-2.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <span>AgentLoops</span>
              <span className="font-mono text-white/70">{routineCount}</span>
            </RepoScopedLink>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {top.map((model) => (
              <ManagedModelOverviewRow key={model.id} model={model} />
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

function managedModelTime(model: ManagedGoalRecord): number {
  const raw =
    model.updatedAt ??
    (typeof model.state.updatedAt === "string" ? model.state.updatedAt : "") ??
    (typeof model.state.createdAt === "string" ? model.state.createdAt : "");
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ManagedModelOverviewRow({ model }: { model: ManagedGoalRecord }) {
  const kind = managedGoalModel(model);
  const href = kind === "agentLoop" ? "/agent-loops" : "/agent-goals";
  const state = model.state.state;

  return (
    <RepoScopedLink
      href={href}
      className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {kind === "agentLoop" ? (
          <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        ) : (
          <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}
        <span className="text-body-sm flex-1 truncate">
          {model.state.destination.outcome || model.id}
        </span>
        <span className="text-label uppercase tracking-wide px-2 py-1 rounded bg-white/[0.06] text-white/55 shrink-0">
          {kind}
        </span>
        <span className="text-label uppercase tracking-wide px-2 py-1 rounded bg-white/[0.06] text-white/55 shrink-0">
          {state}
        </span>
      </div>
      {managedModelTime(model) > 0 ? (
        <span className="text-body-xs text-muted-foreground shrink-0 tabular-nums">
          {timeAgo(
            model.updatedAt ??
              (typeof model.state.updatedAt === "string"
                ? model.state.updatedAt
                : undefined),
          )}
        </span>
      ) : null}
    </RepoScopedLink>
  );
}

function ChannelsOverview() {
  const channelsQuery = useMessageChannels();
  const unread = useChannelsUnread();
  const enabled = channelsQuery.data?.enabled === true;
  const list = enabled ? channelsQuery.data!.channels : [];
  const top = [...list]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);

  return (
    <section>
      <SectionHeader title="Team channels" href="/messages" cta="Messages" />
      {channelsQuery.isLoading ? (
        <p className="text-body-sm text-muted-foreground">Loading channels…</p>
      ) : !enabled ? (
        <Card className="p-3 text-body-sm text-muted-foreground">
          Discussions are off — enable them to use team chat.
        </Card>
      ) : top.length === 0 ? (
        <Card className="p-3 text-body-sm text-muted-foreground">
          No channels yet — create one from the Messages page.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {top.map((c) => {
            const isUnread = unread.unreadChannels.has(c.number);
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <RepoScopedLink
                  href="/messages"
                  className="flex items-center gap-2 min-w-0 flex-1"
                >
                  <MessageCircle
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      isUnread ? "text-violet-300" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-body-sm flex-1 truncate">
                    #{c.name}
                  </span>
                  {isUnread ? (
                    <span className="text-label uppercase tracking-wide px-2 py-1 rounded bg-violet-500/15 text-violet-200 shrink-0">
                      new
                    </span>
                  ) : (
                    <span className="text-body-xs text-muted-foreground shrink-0 tabular-nums">
                      {c.commentsCount} msg{c.commentsCount === 1 ? "" : "s"}
                    </span>
                  )}
                </RepoScopedLink>
                {isUnread ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-body-xs gap-1 shrink-0"
                    disabled={unread.isLoading}
                    onClick={() => unread.markSeen(c.number)}
                    title="Mark this channel as read"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Mark read
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

const ACTOR_TINT: Record<string, string> = {
  user: "bg-sky-400",
  scheduler: "bg-amber-400",
  engine: "bg-emerald-400",
  webhook: "bg-violet-400",
  system: "bg-zinc-400",
};

type ActorTypeFilter =
  | "all"
  | "user"
  | "scheduler"
  | "engine"
  | "webhook"
  | "system";
const FILTER_ORDER: ActorTypeFilter[] = [
  "all",
  "user",
  "engine",
  "scheduler",
  "webhook",
  "system",
];

function ActivityOverview() {
  const { data, isLoading } = useActivityLog(!!getStoredAuth());
  const [filter, setFilter] = useState<ActorTypeFilter>("all");
  const all = useMemo(() => data?.entries ?? [], [data]);

  // Per-type counts drive both the visible chips and the "(N)" badge so
  // the row stays scannable — types with zero events just don't render.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of all) {
      const t = e.actorType ?? "system";
      map[t] = (map[t] ?? 0) + 1;
    }
    return map;
  }, [all]);

  const visibleTypes = FILTER_ORDER.filter(
    (v) => v === "all" || (counts[v] ?? 0) > 0,
  );

  const entries = useMemo(() => {
    const filtered =
      filter === "all"
        ? all
        : all.filter((e) => (e.actorType ?? "system") === filter);
    return filtered.slice(0, 6);
  }, [all, filter]);

  return (
    <section>
      <SectionHeader title="Recent activity" href="/activity" cta="Activity" />
      {visibleTypes.length > 1 ? (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {visibleTypes.map((v) => {
            const isActive = filter === v;
            const dot =
              v === "all" ? "bg-zinc-400" : (ACTOR_TINT[v] ?? "bg-zinc-400");
            const count = v === "all" ? all.length : (counts[v] ?? 0);
            return (
              <button
                key={v}
                type="button"
                onClick={() => setFilter(v)}
                aria-pressed={isActive}
                className={cn(
                  "rounded-full border px-3 py-1 text-body-xs transition inline-flex items-center gap-1.5",
                  isActive
                    ? "border-foreground/30 bg-white/[0.06] text-foreground"
                    : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/20",
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
                {v === "all" ? "All" : v}
                <span className="text-muted-foreground tabular-nums">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {isLoading ? (
        <p className="text-body-sm text-muted-foreground">Loading activity…</p>
      ) : entries.length === 0 ? (
        <Card className="p-3 text-body-sm text-muted-foreground">
          {filter === "all"
            ? "No recent activity yet."
            : `No ${filter} activity in this window.`}
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {entries.map((e: ActionLogEntry) => {
            const tint = ACTOR_TINT[e.actorType ?? "system"] ?? "bg-zinc-400";
            const rowInner = (
              <>
                <span
                  className={cn("w-1.5 h-1.5 rounded-full shrink-0", tint)}
                  title={e.actorType ?? "system"}
                />
                <span className="text-body-sm flex-1 min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {e.actor && e.actor !== "unknown"
                      ? `@${e.actor}`
                      : "system"}
                  </span>{" "}
                  <span className="text-muted-foreground/70">{e.type}</span>{" "}
                  <span>{e.target}</span>
                </span>
                <span className="text-body-xs text-muted-foreground shrink-0 tabular-nums">
                  {timeAgo(e.at)}
                </span>
              </>
            );
            return e.resourceUrl ? (
              <a
                key={e.id}
                href={e.resourceUrl}
                target={e.resourceUrl.startsWith("http") ? "_blank" : undefined}
                rel={
                  e.resourceUrl.startsWith("http")
                    ? "noopener noreferrer"
                    : undefined
                }
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                {rowInner}
              </a>
            ) : (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                {rowInner}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export function DashboardHome() {
  const { auth } = useAuth();

  // refetchInterval "auto" — the "Happening now" panel needs to feel live, so
  // we poll at the board cadence (30s) while work is in flight and back off to
  // idle (60s) when nothing is running. Still one shared task query — no extra
  // GitHub load — and never below the 15s rate-limit floor.
  const {
    data: tasks,
    isLoading: tasksLoading,
    dataUpdatedAt,
  } = useKodyTasks({
    refetchInterval: "auto",
  });
  const all = tasks ?? [];
  const { data: mainCi, isFetching: mainCiFetching } = useDefaultBranchCI();

  if (!auth) {
    return <RepoManager />;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-6">
        <DashboardHeader
          tasks={all}
          tasksLoading={tasksLoading}
          mainCi={mainCi}
          mainCiLoading={mainCiFetching && !mainCi}
          updatedAt={dataUpdatedAt}
        />

        <HappeningNow
          tasks={all}
          tasksLoading={tasksLoading}
          updatedAt={dataUpdatedAt}
        />

        <TriageStrip />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-label font-semibold uppercase tracking-wider text-muted-foreground/80">
              Needs attention
            </h2>
            <RepoScopedLink
              href="/tasks"
              className="text-body-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-2 tabular-nums"
              title="Open the tasks board"
            >
              {tasksLoading ? (
                "—"
              ) : (
                <>
                  <span className="text-amber-300">
                    {countBy(all, ACTIVE_COLUMNS)} active
                  </span>
                  <span aria-hidden>·</span>
                  <span className="text-sky-300">
                    {countBy(all, ["review"])} in review
                  </span>
                </>
              )}
            </RepoScopedLink>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <NeedsYouCard />
            <FailingCard
              tasks={all}
              tasksLoading={tasksLoading}
              ci={mainCi}
            />
          </div>
        </section>

        <section>
          <SectionHeader title="At a glance" href="/tasks" cta="Open board" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={Activity}
              label="Active"
              value={tasksLoading ? "—" : countBy(all, ACTIVE_COLUMNS)}
              tint="text-amber-300 bg-amber-500/10"
              href="/tasks"
            />
            <StatTile
              icon={GitPullRequest}
              label="In review"
              value={tasksLoading ? "—" : countBy(all, ["review"])}
              tint="text-sky-300 bg-sky-500/10"
              href="/tasks"
            />
            <StatTile
              icon={Inbox}
              label="Backlog"
              value={tasksLoading ? "—" : countBy(all, ["open"])}
              tint="text-zinc-300 bg-white/[0.06]"
              href="/tasks"
            />
            <StatTile
              icon={CheckCircle2}
              label="Done"
              value={tasksLoading ? "—" : countBy(all, ["done"])}
              tint="text-emerald-300 bg-emerald-500/10"
              href="/tasks"
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2">
          <ModelsOverview />
          <ChannelsOverview />
          <LatestReports />
          <EngineHealth />
        </div>

        <ActivityOverview />
      </div>
    </div>
  );
}
