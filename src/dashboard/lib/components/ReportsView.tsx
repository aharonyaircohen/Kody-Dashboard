/**
 * @fileType component
 * @domain kody
 * @pattern reports-page
 * @ai-summary Reports view — list and read system reports under
 *   `kody-state:.kody/reports/<slug>.md`. Read-only. Mobile-first responsive
 *   layout that mirrors DutyControl: master/detail with a back button on
 *   small viewports.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  Target,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { cn } from "../utils";
import { useReports } from "../hooks/useReports";
import { useReportsUnread } from "../hooks/useReportsUnread";
import { kodyApi, type Report } from "../api";
import type { ReportSuggestedAction } from "../report-suggested-actions";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { CreateGoalDialog } from "./GoalControl";
import { useChatScope } from "./ChatRailShell";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";

const DISMISSED_REPORT_ACTIONS_KEY = "kody.report-actions.dismissed";

interface ReportsViewProps {
  /** Render without the built-in PageHeader (e.g. when hosted in DutiesPageTabs). */
  embedded?: boolean;
}

export function ReportsView({ embedded = false }: ReportsViewProps = {}) {
  return (
    <AuthGuard>
      <ReportsViewInner embedded={embedded} />
    </AuthGuard>
  );
}

export function ReportsViewInner({ embedded = false }: ReportsViewProps = {}) {
  const { auth } = useAuth();
  const {
    data: reports = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useReports();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { isUnread, markRead } = useReportsUnread();
  // Resource generators — pop dialogs prefilled from the active report.
  const [issueFromReport, setIssueFromReport] = useState<Report | null>(null);
  const [goalFromReport, setGoalFromReport] = useState<Report | null>(null);
  const [taskFromAction, setTaskFromAction] = useState<{
    report: Report;
    action: ReportSuggestedAction;
  } | null>(null);
  const [runningActionKey, setRunningActionKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        r.slug.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q) ||
        (r.suggestedActions ?? []).some((a) =>
          [a.label, a.reason ?? "", a.executable ?? "", a.title ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        ),
    );
  }, [reports, search]);

  const selected = useMemo(
    () => reports.find((r) => r.slug === selectedSlug) ?? null,
    [reports, selectedSlug],
  );

  // Auto-select first report on desktop only (preserve mobile list view).
  useEffect(() => {
    if (selectedSlug || filtered.length === 0) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches
    ) {
      setSelectedSlug(filtered[0]!.slug);
    }
  }, [filtered, selectedSlug]);

  // Mark a report as read the moment it's opened in the detail pane —
  // this is the "I've seen it" signal that drives the sidebar's
  // ReportsBadge unread count down.
  useEffect(() => {
    if (selected) markRead(selected.slug, selected.updatedAt);
  }, [selected, markRead]);

  // Push the active report into the chat scope so KodyChat in the rail
  // knows which report the user is viewing and can advise on follow-up
  // (create issue, attach to a goal, or no action).
  const { setScope } = useChatScope();
  useEffect(() => {
    if (selected) {
      setScope({
        kind: "report",
        report: {
          slug: selected.slug,
          title: selected.title,
          body: selected.body,
        },
      });
    } else {
      setScope(null);
    }
    return () => setScope(null);
  }, [selected, setScope]);

  const runSuggestedAction = async (
    report: Report,
    action: ReportSuggestedAction,
  ) => {
    const duty = action.executable;
    if (
      action.type !== "dispatch" ||
      !duty ||
      typeof action.target !== "number"
    ) {
      toast.error("This report action cannot be dispatched");
      return;
    }
    const key = `${report.slug}:${action.id}`;
    setRunningActionKey(key);
    try {
      await kodyApi.jobs.run(
        {
          duty,
          executable: action.executable,
          target: action.target,
          flavor: "instant",
          cliArgs: {},
          why: `from report ${report.slug}: ${action.reason ?? action.label}`,
        },
        auth?.user?.login,
      );
      toast.success(`Dispatched ${duty} on #${action.target}`);
    } catch (err) {
      toast.error("Dispatch failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunningActionKey(null);
    }
  };

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {embedded ? (
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
          <span className="text-xs text-muted-foreground mr-auto">
            {reports.length} {reports.length === 1 ? "report" : "reports"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh reports"
          >
            <RefreshCw
              className={cn("w-4 h-4", isFetching && "animate-spin")}
            />
          </Button>
        </div>
      ) : (
        <PageHeader
          title="Reports"
          icon={FileText}
          iconClassName="text-sky-400"
          subtitle={`${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh reports"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
          }
        />
      )}

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load reports: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        {/* List — full width on mobile, fixed sidebar on desktop. Hidden
            on mobile when a report is selected so the detail takes over. */}
        <aside
          className={cn(
            "w-full md:w-96 md:border-r md:border-border flex flex-col min-h-0",
            selected && "hidden md:flex",
          )}
        >
          <div className="shrink-0 px-3 md:px-4 py-2 md:py-3 border-b border-border">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className={cn(
                "w-full bg-background/40 border border-border rounded-md",
                "px-3 py-2 text-sm placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-sky-500/40",
              )}
              aria-label="Search reports"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading reports…" />
            ) : reports.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No reports yet"
                hint="Reports appear here once Kody duties (doc-drift, coverage-floor, etc.) commit them to kody state."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No matching reports"
                hint={`Nothing matched "${search}". Try a different query.`}
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((report) => (
                  <li key={report.slug}>
                    <ReportRow
                      report={report}
                      isActive={selectedSlug === report.slug}
                      unread={isUnread(report.slug, report.updatedAt)}
                      onSelect={() => setSelectedSlug(report.slug)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Detail — full width on mobile when selected, flexes to fill
            remaining space on desktop. */}
        <section
          className={cn(
            "flex-1 min-w-0 overflow-y-auto",
            !selected && "hidden md:block",
          )}
        >
          {selected ? (
            <ReportDetail
              report={selected}
              onBack={() => setSelectedSlug(null)}
              onCreateIssue={() => setIssueFromReport(selected)}
              onPlanGoal={() => setGoalFromReport(selected)}
              onCreateTaskFromAction={(action) =>
                setTaskFromAction({ report: selected, action })
              }
              onRunAction={(action) =>
                void runSuggestedAction(selected, action)
              }
              runningActionKey={runningActionKey}
            />
          ) : (
            <EmptyState
              icon={<FileText />}
              title="Select a report"
              hint="Pick a report from the list to view its contents."
            />
          )}
        </section>
      </div>

      {/* Generate issue from the active report. Title and body are
          prefilled; a `from-report:<slug>` label keeps the lineage
          discoverable in the issue tracker. */}
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

      <CreateTaskDialog
        open={!!taskFromAction}
        onClose={() => setTaskFromAction(null)}
        prefill={
          taskFromAction
            ? buildTaskPrefillFromAction(
                taskFromAction.report,
                taskFromAction.action,
              )
            : undefined
        }
        onCreated={() => setTaskFromAction(null)}
      />

      {/* Generate a goal from the report. Description seeds the goal
          body so the planner / chat has full context for decomposition. */}
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
    </div>
  );
}

function ReportRow({
  report,
  isActive,
  unread,
  onSelect,
}: {
  report: Report;
  isActive: boolean;
  unread: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
        isActive && "bg-accent/70",
      )}
    >
      {isActive ? (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-sky-400" />
      ) : null}
      <div className="flex items-center gap-2">
        <FileText
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            isActive ? "text-sky-400" : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "text-sm truncate flex-1",
            unread ? "font-semibold text-foreground" : "font-medium",
          )}
        >
          {report.title}
        </span>
        {unread ? (
          <span
            className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0"
            aria-label="unread report"
          />
        ) : null}
      </div>
      {report.reviewStatus ? (
        <div className="mt-1">
          <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">
            {report.reviewStatus}
            {report.reviewArea ? ` · ${report.reviewArea}` : ""}
          </span>
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
        <span className="font-mono opacity-80 truncate">{report.slug}</span>
        <span aria-hidden>·</span>
        {(report.suggestedActions ?? []).length > 0 ? (
          <>
            <span>
              {(report.suggestedActions ?? []).length} suggested{" "}
              {(report.suggestedActions ?? []).length === 1
                ? "action"
                : "actions"}
            </span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatRelative(report.updatedAt)}
        </span>
      </div>
    </button>
  );
}

function ReportDetail({
  report,
  onBack,
  onCreateIssue,
  onPlanGoal,
  onCreateTaskFromAction,
  onRunAction,
  runningActionKey,
}: {
  report: Report;
  onBack: () => void;
  onCreateIssue: () => void;
  onPlanGoal: () => void;
  onCreateTaskFromAction: (action: ReportSuggestedAction) => void;
  onRunAction: (action: ReportSuggestedAction) => void;
  runningActionKey: string | null;
}) {
  const hasBody = report.body.trim().length > 0;
  const dismissed = useDismissedReportActions(report.slug);
  const visibleActions = (report.suggestedActions ?? []).filter(
    (action) => !dismissed.ids.has(action.id),
  );
  return (
    <article className="h-full flex flex-col">
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-border bg-black/10 flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="md:hidden shrink-0 -ml-2"
          aria-label="Back to reports"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-xl font-semibold truncate">
            {report.title}
          </h1>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono opacity-80 truncate">{report.slug}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              updated {formatRelative(report.updatedAt)}
            </span>
            {report.reviewStatus ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  review {report.reviewStatus}
                  {report.reviewArea ? ` (${report.reviewArea})` : ""}
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <a
              href={report.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              title="Open on GitHub"
            >
              <ExternalLink className="w-3 h-3" />
              GitHub
            </a>
          </div>
        </div>
        {/* Resource generators — turn the report into actionable work. */}
        <div className="shrink-0 flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onPlanGoal}
            className="gap-1.5"
            title="Create a new goal pre-filled from this report"
          >
            <Target className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Plan goal</span>
          </Button>
          <Button
            size="sm"
            onClick={onCreateIssue}
            className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-white"
            title="Create a GitHub issue pre-filled from this report"
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Create issue</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          {visibleActions.length > 0 ? (
            <SuggestedActions
              report={report}
              actions={visibleActions}
              runningActionKey={runningActionKey}
              onRun={onRunAction}
              onCreateTask={onCreateTaskFromAction}
              onDismiss={dismissed.dismiss}
            />
          ) : null}

          {hasBody ? (
            <MarkdownPreview
              content={report.body}
              className="md:prose-base break-words"
            />
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Empty report
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                The duty that produces this report hasn&apos;t written content
                yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function SuggestedActions({
  report,
  actions,
  runningActionKey,
  onRun,
  onCreateTask,
  onDismiss,
}: {
  report: Report;
  actions: ReportSuggestedAction[];
  runningActionKey: string | null;
  onRun: (action: ReportSuggestedAction) => void;
  onCreateTask: (action: ReportSuggestedAction) => void;
  onDismiss: (actionId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
        <h2 className="text-sm font-semibold text-white/90">
          Suggested actions
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {actions.length}
        </span>
      </div>
      <ul className="space-y-2">
        {actions.map((action) => {
          const key = `${report.slug}:${action.id}`;
          const running = runningActionKey === key;
          return (
            <li
              key={action.id}
              className="flex flex-col gap-3 rounded-md border border-white/[0.06] bg-black/20 px-3 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white/90">
                    {action.label}
                  </span>
                  <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                    {action.type}
                  </span>
                </div>
                {action.reason ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {action.reason}
                  </p>
                ) : null}
                {action.type === "dispatch" && action.executable ? (
                  <p className="mt-1 font-mono text-[11px] text-white/45">
                    {action.executable}
                    {typeof action.target === "number"
                      ? ` on #${action.target}`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {action.type === "dispatch" ? (
                  <Button
                    size="sm"
                    disabled={
                      running ||
                      !action.executable ||
                      typeof action.target !== "number"
                    }
                    onClick={() => onRun(action)}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {running ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Run
                  </Button>
                ) : action.type === "create-task" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCreateTask(action)}
                    className="gap-1.5"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    Create task
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDismiss(action.id)}
                    className="gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Dismiss
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function buildTaskPrefillFromAction(
  report: Report,
  action: ReportSuggestedAction,
) {
  return {
    title: action.title ?? action.label,
    body:
      (action.body ?? action.reason ?? action.label) +
      `\n\n---\n\nSource report: [\`.kody/reports/${report.slug}.md\`](${report.htmlUrl})`,
    labels: [`from-report:${report.slug}`, ...(action.labels ?? [])],
  };
}

function readDismissedActions(slug: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_REPORT_ACTIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Set();
    }
    const values = (parsed as Record<string, unknown>)[slug];
    return new Set(Array.isArray(values) ? values.filter(isString) : []);
  } catch {
    return new Set();
  }
}

function writeDismissedActions(slug: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DISMISSED_REPORT_ACTIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const map =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    map[slug] = [...ids];
    window.localStorage.setItem(
      DISMISSED_REPORT_ACTIONS_KEY,
      JSON.stringify(map),
    );
  } catch {
    // Ignore private-mode/quota failures; the in-memory state still updates.
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function useDismissedReportActions(slug: string) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setIds(readDismissedActions(slug));
  }, [slug]);

  const dismiss = useCallback(
    (actionId: string) => {
      setIds((prev) => {
        const next = new Set(prev);
        next.add(actionId);
        writeDismissedActions(slug, next);
        return next;
      });
    },
    [slug],
  );

  return { ids, dismiss };
}
