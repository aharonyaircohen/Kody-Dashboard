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
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  GitBranch,
  Hammer,
  Inbox,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@dashboard/ui/card";
import { HappeningNow } from "./HappeningNow";
import { useKodyTasks } from "../hooks";
import { useDuties } from "../hooks/useDuties";
import { useReports } from "../hooks/useReports";
import { useDefaultBranchCI } from "../hooks/useDefaultBranchCI";
import { useHealth } from "../hooks/useHealth";
import { useInbox } from "../inbox/useInbox";
import { cn } from "../utils";
import type { ColumnId, KodyTask } from "../types";
import type { HealthLevel } from "../health/types";

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
              {isLoading
                ? "Loading…"
                : `${unreadCount} awaiting your decision`}
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
            <a
              href={ci.latestRun.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-2 -mx-2 rounded-md hover:bg-white/[0.04] transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              <span className="text-sm flex-1 truncate">
                {ci.branch} CI red
                <span className="text-muted-foreground">
                  {" "}
                  — {ci.latestRun.name}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {timeAgo(ci.latestRun.updated_at)}
              </span>
            </a>
          )}
          {failed.map((t) => (
            <Link
              key={t.id}
              href={`/${t.issueNumber}`}
              className="flex items-start gap-2 px-2 py-2 -mx-2 rounded-md hover:bg-white/[0.04] transition-colors"
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
          ))}
        </div>
      )}
    </Card>
  );
}

// ── lower sections ──────────────────────────────────────────────────────────

function DutiesHealth() {
  const { data, isLoading } = useDuties();
  const duties = data ?? [];
  const enabled = duties.filter((d) => !d.disabled);
  const failing = enabled.filter((d) => d.lastOutcome === "failed");

  return (
    <section>
      <SectionHeader title="Duties health" href="/duties" cta="Duties" />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading duties…</p>
      ) : duties.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No duties yet.</Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium tabular-nums">
                {enabled.length}
              </span>{" "}
              active
            </span>
            <span className="text-muted-foreground">
              <span
                className={cn(
                  "font-medium tabular-nums",
                  failing.length > 0 ? "text-rose-300" : "text-foreground",
                )}
              >
                {failing.length}
              </span>{" "}
              failing
            </span>
          </div>
          {failing.length > 0 && (
            <div className="space-y-1 border-t border-white/[0.06] pt-2">
              {failing.slice(0, 5).map((d) => (
                <Link
                  key={d.slug}
                  href="/duties"
                  className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-md hover:bg-white/[0.04] transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                  <span className="text-sm flex-1 truncate">{d.title}</span>
                  {d.staff && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {d.staff}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {timeAgo(d.lastTickAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

function LatestReports() {
  const { data, isLoading } = useReports();
  const reports = [...(data ?? [])]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);

  return (
    <section>
      <SectionHeader
        title="Latest reports"
        href="/duties?tab=reports"
        cta="Reports"
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : reports.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No reports yet — duty runs write them here.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {reports.map((r) => (
            <Link
              key={r.slug}
              href="/duties?tab=reports"
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <FileText className="w-4 h-4 text-sky-300 shrink-0" />
              <span className="text-sm flex-1 truncate">{r.title}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {timeAgo(r.updatedAt)}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </section>
  );
}

function EngineHealth() {
  const { data, isLoading } = useHealth();
  const level = data?.level ?? "ok";
  const problems = (data?.signals ?? []).filter((s) => s.level !== "ok");

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
        {problems.length > 0 && (
          <div className="space-y-1 border-t border-white/[0.06] pt-2">
            {problems.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-2 px-2 py-1.5 -mx-2"
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
              </div>
            ))}
          </div>
        )}
      </Card>
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
        {/* 0 — What's in motion this minute, with a freshness stamp. */}
        <HappeningNow
          tasks={all}
          tasksLoading={tasksLoading}
          updatedAt={dataUpdatedAt}
        />

        {/* 1 — Statistics: the task pulse at a glance. */}
        <section>
          <SectionHeader title="At a glance" href="/tasks" cta="Open board" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={Hammer}
              label="Active"
              value={tasksLoading ? "—" : countBy(all, ACTIVE_COLUMNS)}
              tint="text-amber-300 bg-amber-500/10"
              href="/tasks"
            />
            <StatTile
              icon={Activity}
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

        {/* 2 — Attention: the two things that might need action right now. */}
        <section>
          <SectionHeader title="Needs attention" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <NeedsYouCard />
            <FailingCard tasks={all} tasksLoading={tasksLoading} />
          </div>
        </section>

        {/* 3 — Supporting detail, two-up so it reads as a tidy grid rather
              than one long stacked column. Engine health spans both below. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-10">
          <DutiesHealth />
          <LatestReports />
        </div>

        <EngineHealth />
      </div>
    </div>
  );
}
