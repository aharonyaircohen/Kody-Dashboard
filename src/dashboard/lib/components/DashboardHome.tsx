/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-overview
 * @ai-summary The operations overview rendered at `/` (the "Dashboard" view).
 *   An at-a-glance control panel built top-to-bottom around "what needs me,
 *   what's broken": an attention row (inbox approvals + failures), a task
 *   pulse, duties health, latest reports, and engine health. Every section
 *   rides a hook the rest of the dashboard already polls, so it adds no new
 *   GitHub load — it just composes existing caches into one screen. `/` used
 *   to redirect to /tasks; it now lands here, with Tasks/Vibe one click away
 *   in the rail's "Views" group.
 */
"use client";

import Link from "next/link";
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
  Play,
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
import { useGoals } from "../hooks/useGoals";
import { useGoalState, useSetGoalState } from "../hooks/useGoalState";
import { useMessageChannels } from "../hooks/useMessages";
import { useChannelsUnread } from "../hooks/useChannelsUnread";
import { useActivityLog } from "../hooks/useActivityLog";
import { useInbox } from "../inbox/useInbox";
import {
  useAcknowledgeHealthSignal,
  useCreateFixCITask,
  useRerunCIRun,
  useRetryTask,
} from "../hooks/useDashboardActions";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { CreateGoalDialog } from "./GoalControl";
import { cn } from "../utils";
import type { ColumnId, KodyTask } from "../types";
import type { HealthLevel } from "../health/types";
import type { Goal, Report } from "../api";
import { getStoredAuth } from "../api";
import type { ActionLogEntry } from "../activity/action-log";

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
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {cta} <ArrowRight className="w-3 h-3" />
        </Link>
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
    <Link href={href} className="block">
      <Card className="p-4 hover:bg-white/[0.04] transition-colors h-full">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md shrink-0",
              tint,
            )}
          >
            <Icon className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-2xl font-semibold leading-none tabular-nums">
              {value}
            </div>
            <div className="text-xs text-muted-foreground truncate mt-1">
              {label}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/** A calm "nothing to do" state inside an attention card. */
function AllClear({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
      {message}
    </div>
  );
}

// ── attention cards ─────────────────────────────────────────────────────────

/**
 * "Needs you" — unread inbox count plus a breakdown by what kind of thing is
 * waiting (approvals / mentions / reviews / other). Stats, not a scrolling list
 * of items — the full items live one click away on /inbox.
 */
function NeedsYouCard() {
  const { unread, unreadCount, isLoading } = useInbox();

  const approvals = unread.filter((e) => e.ctoAction).length;
  const mentions = unread.filter(
    (e) =>
      !e.ctoAction && (e.source === "mention" || e.source === "team_mention"),
  ).length;
  const reviews = unread.filter(
    (e) => !e.ctoAction && e.source === "review_requested",
  ).length;
  const other = unreadCount - approvals - mentions - reviews;

  const stats = [
    { label: "Approvals", value: approvals, tone: "text-amber-300" },
    { label: "Mentions", value: mentions, tone: "text-sky-300" },
    { label: "Reviews", value: reviews, tone: "text-violet-300" },
    { label: "Other", value: other, tone: "text-foreground" },
  ].filter((s) => s.value > 0);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              unreadCount > 0
                ? "text-amber-300 bg-amber-500/10"
                : "text-emerald-300 bg-emerald-500/10",
            )}
          >
            <Inbox className="w-4 h-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Needs you</div>
            <div className="text-xs text-muted-foreground">
              {isLoading ? "Loading…" : `${unreadCount} awaiting your decision`}
            </div>
          </div>
        </div>
        <Link
          href="/inbox"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Inbox <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {!isLoading && unreadCount === 0 ? (
        <AllClear message="You're all caught up." />
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {stats.map((s) => (
            <Link
              key={s.label}
              href="/inbox"
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
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </Link>
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
}: {
  tasks: KodyTask[];
  tasksLoading: boolean;
}) {
  const { data: ci } = useDefaultBranchCI();
  const { githubUser } = useGitHubIdentity();
  const rerunCI = useRerunCIRun();
  const createFixCI = useCreateFixCITask();
  const retryTask = useRetryTask(githubUser?.login);
  const ciRed = ci?.state === "failure";
  const failed = tasks.filter((t) => t.column === "failed").slice(0, 5);
  const nothingWrong = !ciRed && failed.length === 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              nothingWrong
                ? "text-emerald-300 bg-emerald-500/10"
                : "text-rose-300 bg-rose-500/10",
            )}
          >
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Failing</div>
            <div className="text-xs text-muted-foreground">
              CI &amp; failed tasks
            </div>
          </div>
        </div>
        <Link
          href="/tasks"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Tasks <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {tasksLoading ? (
        <p className="text-sm text-muted-foreground py-2">Loading…</p>
      ) : nothingWrong ? (
        <AllClear message="Nothing failing right now." />
      ) : (
        <div className="space-y-1">
          {ciRed && ci?.latestRun && (
            <div className="flex items-center gap-2 px-2 py-2 -mx-2 rounded-md hover:bg-white/[0.04] transition-colors">
              <GitBranch className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              <a
                href={ci.latestRun.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm flex-1 min-w-0 truncate"
                title="Open the failing run on GitHub"
              >
                {ci.branch} CI red
                <span className="text-muted-foreground">
                  {" "}
                  — {ci.latestRun.name}
                </span>
              </a>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(ci.latestRun.updated_at)}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
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
                  className="h-6 px-2 text-[11px] gap-1"
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
              className="flex items-center gap-2 px-2 py-2 -mx-2 rounded-md hover:bg-white/[0.04] transition-colors"
            >
              <Link
                href={`/${t.issueNumber}`}
                className="flex items-start gap-2 min-w-0 flex-1"
              >
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10 mt-0.5">
                  #{t.issueNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{t.title}</div>
                  {t.failureReason && (
                    <div className="text-xs text-rose-300/80 truncate">
                      {t.failureReason}
                    </div>
                  )}
                </div>
              </Link>
              <div className="flex items-center gap-1 shrink-0">
                {t.workflowRun?.html_url && (
                  <a
                    href={t.workflowRun.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-6 px-2 text-[11px] inline-flex items-center gap-1 rounded-md border border-white/[0.08] hover:bg-white/[0.06] text-muted-foreground hover:text-foreground"
                    title="Open the workflow run logs"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Logs
                  </a>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
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

// ── restored sections (Reports + Engine) ─────────────────────────────────────

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
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : reports.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No reports yet — duty runs write them here.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {reports.map((r) => (
            <div
              key={r.slug}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <Link
                href="/reports"
                className="flex items-center gap-3 min-w-0 flex-1"
              >
                <FileText className="w-4 h-4 text-sky-300 shrink-0" />
                <span className="text-sm flex-1 truncate">{r.title}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {timeAgo(r.updatedAt)}
                </span>
              </Link>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() => setGoalFromReport(r)}
                  title="Plan a new goal from this report"
                >
                  <Target className="w-3 h-3 text-emerald-400" />
                  Plan goal
                </Button>
                <Button
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1 bg-sky-600 hover:bg-sky-700 text-white"
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
                  `Source report: [\`.kody/reports/${issueFromReport.slug}.md\`](${issueFromReport.htmlUrl})\n\n` +
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
                  `Source report: [\`.kody/reports/${goalFromReport.slug}.md\`](${goalFromReport.htmlUrl})\n\n` +
                  `---\n\n${goalFromReport.body}`,
              }
            : undefined
        }
        onCreated={() => setGoalFromReport(null)}
      />
    </section>
  );
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
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              LEVEL_TINT[level],
            )}
          >
            <Activity className="w-4 h-4" />
          </span>
          <div className="text-sm">
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
                      "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 mt-0.5",
                      LEVEL_TINT[s.level],
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1">
                    {s.detail}
                  </span>
                  {isAcked ? (
                    <button
                      type="button"
                      onClick={() => ack.unacknowledge(s.id)}
                      className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title="Restore this signal"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ack.acknowledge(s.id)}
                      className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title="Acknowledge — mute this signal until the next state change"
                    >
                      Ack
                    </button>
                  )}
                </div>
              );
            })}
            {ackedCount > 0 ? (
              <div className="text-[10px] text-muted-foreground px-2 pt-1">
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

function GoalsOverview() {
  const { data: goals = [], isLoading } = useGoals();
  const top = [...goals]
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt ?? b.createdAt) -
        Date.parse(a.updatedAt ?? a.createdAt),
    )
    .slice(0, 4);

  return (
    <section>
      <SectionHeader title="Goals" />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading goals…</p>
      ) : goals.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No goals yet — plan one from a report.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {top.map((g: Goal) => (
            <GoalOverviewRow key={g.id} goal={g} />
          ))}
        </Card>
      )}
    </section>
  );
}

function GoalOverviewRow({ goal }: { goal: Goal }) {
  const { githubUser } = useGitHubIdentity();
  const { data: runState } = useGoalState(goal.id);
  const setState = useSetGoalState(goal.id, githubUser?.login);
  const isActive = runState?.state === "active";
  const isPaused = runState?.state === "paused";
  const showToggle = isActive || isPaused;

  return (
    <div className="flex items-center gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-sm flex-1 truncate">{goal.name}</span>
        {goal.assignee ? (
          <span className="text-[11px] text-muted-foreground shrink-0">
            @{goal.assignee}
          </span>
        ) : null}
        {goal.dueDate ? (
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            due {new Date(goal.dueDate).toLocaleDateString()}
          </span>
        ) : null}
        {isPaused ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 shrink-0">
            paused
          </span>
        ) : null}
      </div>
      {showToggle ? (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] gap-1 shrink-0"
          disabled={setState.isPending}
          onClick={() =>
            setState.mutate({ state: isActive ? "paused" : "active" })
          }
          title={
            isActive ? "Pause this goal's runner" : "Resume this goal's runner"
          }
        >
          {setState.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : isActive ? (
            <X className="w-3 h-3" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {isActive ? "Pause" : "Resume"}
        </Button>
      ) : null}
    </div>
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
        <p className="text-sm text-muted-foreground">Loading channels…</p>
      ) : !enabled ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Discussions are off — enable them to use team chat.
        </Card>
      ) : top.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No channels yet — create one from the Messages page.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {top.map((c) => {
            const isUnread = unread.unreadChannels.has(c.number);
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors"
              >
                <Link
                  href="/messages"
                  className="flex items-center gap-2 min-w-0 flex-1"
                >
                  <MessageCircle
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      isUnread ? "text-violet-300" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-sm flex-1 truncate">#{c.name}</span>
                  {isUnread ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 shrink-0">
                      new
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {c.commentsCount} msg{c.commentsCount === 1 ? "" : "s"}
                    </span>
                  )}
                </Link>
                {isUnread ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] gap-1 shrink-0"
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
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition inline-flex items-center gap-1.5",
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
        <p className="text-sm text-muted-foreground">Loading activity…</p>
      ) : entries.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
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
                <span className="text-sm flex-1 min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {e.actor && e.actor !== "unknown"
                      ? `@${e.actor}`
                      : "system"}
                  </span>{" "}
                  <span className="text-muted-foreground/70">{e.type}</span>{" "}
                  <span>{e.target}</span>
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
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
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
              >
                {rowInner}
              </a>
            ) : (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-6 space-y-10">
        {/* 0 — Ranked, dismissable cross-tile triage list. Renders only when
               there's something to act on; collapses to nothing on a quiet
               repo. Same hooks as the source cards — no extra GitHub load. */}
        <TriageStrip />

        {/* 1 — What's in motion this minute, with a freshness stamp. */}
        <HappeningNow
          tasks={all}
          tasksLoading={tasksLoading}
          updatedAt={dataUpdatedAt}
        />

        {/* 2 — Backlog + done are the unique-value rollups; active and
               in-review move down into the attention row as an in-flight
               chip so they don't duplicate HappeningNow. */}
        <section>
          <SectionHeader title="At a glance" href="/tasks" cta="Open board" />
          <div className="grid grid-cols-2 gap-3">
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

        {/* 3 — Attention: the two things that might need action right now.
               The in-flight chip (active / in review) lives in the header
               because HappeningNow already renders those tasks in detail
               below. */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Needs attention
            </h2>
            <Link
              href="/tasks"
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 tabular-nums"
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
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <NeedsYouCard />
            <FailingCard tasks={all} tasksLoading={tasksLoading} />
          </div>
        </section>

        {/* 4 — 2×2 grid: strategic + meta. Goals & channels on top, reports
              & engine health below. Keeps the page dense without long
              single-column stacks. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-10">
          <GoalsOverview />
          <ChannelsOverview />
          <LatestReports />
          <EngineHealth />
        </div>

        {/* 5 — Historical slice: most recent operator / engine actions. */}
        <ActivityOverview />
      </div>
    </div>
  );
}
