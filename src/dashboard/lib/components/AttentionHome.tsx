/**
 * @fileType component
 * @domain kody
 * @pattern attention-home
 * @ai-summary Home-page control loop: needs you, running, done with proof,
 *   and quiet background. It renders AttentionItems from existing hooks rather
 *   than exposing each source model as a separate mental model.
 */
"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  RefreshCw,
  Square,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card } from "@dashboard/ui/card";
import type {
  AttentionAction,
  AttentionItem,
  AttentionSection,
  AttentionSource,
  AttentionStatus,
} from "../attention/types";
import { useAttentionItems } from "../attention/useAttentionItems";
import { useAuth } from "../auth-context";
import { repoScopedHref } from "../routes";
import { autoDirProps } from "../text-direction";
import { cn } from "../utils";

const SECTION_COPY: Record<
  AttentionSection,
  { title: string; empty: string; icon: LucideIcon }
> = {
  needs_you: {
    title: "Needs you",
    empty: "Nothing needs attention.",
    icon: AlertTriangle,
  },
  running: {
    title: "Running",
    empty: "Nothing running right now.",
    icon: CircleDot,
  },
  done: {
    title: "Done with proof",
    empty: "No recent proof yet.",
    icon: CheckCircle2,
  },
  quiet: {
    title: "Quiet background",
    empty: "No quiet background signals yet.",
    icon: Activity,
  },
};

const SECTION_ORDER: AttentionSection[] = [
  "needs_you",
  "running",
  "done",
  "quiet",
];

const SOURCE_ICON: Record<AttentionSource, LucideIcon> = {
  task: Target,
  ci: GitBranch,
  report: FileText,
  health: Activity,
  activity: Clock,
  goal: Target,
  brain: CircleDot,
};

const STATUS_TINT: Record<AttentionStatus, string> = {
  blocked: "text-rose-200 bg-rose-500/12 border-rose-400/20",
  failed: "text-rose-200 bg-rose-500/12 border-rose-400/20",
  waiting: "text-amber-200 bg-amber-500/12 border-amber-400/20",
  running: "text-sky-200 bg-sky-500/12 border-sky-400/20",
  done: "text-emerald-200 bg-emerald-500/12 border-emerald-400/20",
  healthy: "text-zinc-200 bg-white/[0.05] border-white/10",
};

function shortAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function itemHref(auth: ReturnType<typeof useAuth>["auth"], href?: string) {
  if (!href) return undefined;
  if (href.startsWith("http") || !auth) return href;
  return repoScopedHref(auth, href);
}

function useScopedHref() {
  const { auth } = useAuth();
  return (href?: string) => itemHref(auth, href);
}

function ActionButton({ action }: { action: AttentionAction }) {
  const scopedHref = useScopedHref();
  const href = scopedHref(action.href);
  const icon = action.pending ? (
    <Loader2 className="w-3 h-3 animate-spin" />
  ) : action.kind === "retry" ? (
    <RefreshCw className="w-3 h-3" />
  ) : action.kind === "stop" ? (
    <Square className="w-3 h-3" />
  ) : action.kind === "dismiss" ? (
    <X className="w-3 h-3" />
  ) : action.kind === "view-proof" ? (
    <ExternalLink className="w-3 h-3" />
  ) : (
    <ArrowRight className="w-3 h-3" />
  );

  const className = cn(
    "h-7 gap-1.5 px-2.5 text-body-xs",
    action.variant === "danger" &&
      "border-rose-400/20 text-rose-200 hover:bg-rose-500/10",
  );

  if (href) {
    const external = action.external || href.startsWith("http");
    if (external) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 text-body-xs text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          title={action.title}
        >
          {icon}
          {action.label}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 text-body-xs text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        title={action.title}
      >
        {icon}
        {action.label}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      title={action.title}
      disabled={action.disabled || action.pending}
      onClick={action.onClick}
    >
      {icon}
      {action.label}
    </Button>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const scopedHref = useScopedHref();
  const href = scopedHref(item.href);
  const SourceIcon = SOURCE_ICON[item.source];

  const title = (
    <span {...autoDirProps} className="truncate text-start text-body-sm">
      {item.title}
    </span>
  );

  return (
    <div className="flex min-h-[76px] flex-col gap-3 px-4 py-3 hover:bg-white/[0.035] transition-colors sm:flex-row sm:items-center">
      <div className="flex w-full min-w-0 items-center gap-3 sm:flex-1">
        <span
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
            STATUS_TINT[item.status],
          )}
        >
          <SourceIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {href ? (
              href.startsWith("http") ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 hover:underline"
                >
                  {title}
                </a>
              ) : (
                <Link href={href} className="min-w-0 hover:underline">
                  {title}
                </Link>
              )
            ) : (
              title
            )}
            {item.owner ? (
              <span className="shrink-0 text-body-xs text-muted-foreground">
                @{item.owner}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-body-xs text-muted-foreground">
            <span className="truncate">{item.reason}</span>
            {item.occurredAt ? (
              <span className="shrink-0 tabular-nums">
                {shortAgo(item.occurredAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {item.actions.length > 0 ? (
        <div className="flex w-full flex-wrap items-center gap-1.5 pl-12 sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
          {item.actions.slice(0, 3).map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AttentionSectionCard({
  section,
  items,
}: {
  section: AttentionSection;
  items: AttentionItem[];
}) {
  const copy = SECTION_COPY[section];
  const Icon = copy.icon;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-label font-semibold uppercase tracking-wider text-muted-foreground/80">
          {copy.title}
        </h2>
        <span className="text-body-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <div className="flex min-h-[76px] items-center gap-3 px-4 py-3 text-body-sm text-muted-foreground">
            <Icon className="w-4 h-4 text-muted-foreground/60" />
            {copy.empty}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

export function AttentionHome() {
  const { bySection, isLoading, dataUpdatedAt } = useAttentionItems();
  const needsCount = bySection.needs_you.length;
  const runningCount = bySection.running.length;
  const doneCount = bySection.done.length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 space-y-8">
        <header className="flex flex-col gap-3 border-b border-white/[0.06] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              What needs attention now?
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
              <span className="tabular-nums text-amber-200">
                {needsCount} need you
              </span>
              <span className="tabular-nums text-sky-200">
                {runningCount} running
              </span>
              <span className="tabular-nums text-emerald-200">
                {doneCount} done
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-body-xs text-muted-foreground">
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading
              </>
            ) : dataUpdatedAt > 0 ? (
              <>Updated {shortAgo(new Date(dataUpdatedAt).toISOString())} ago</>
            ) : null}
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {SECTION_ORDER.map((section) => (
            <AttentionSectionCard
              key={section}
              section={section}
              items={bySection[section]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
