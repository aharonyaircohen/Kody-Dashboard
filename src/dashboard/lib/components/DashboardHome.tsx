/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-overview
 * @ai-summary The operations overview rendered at `/` (the "Dashboard" view).
 *   A read-only landing: task counts by lane, quick links to the primary
 *   surfaces, and the most recently updated tasks. `/` used to redirect to
 *   /tasks; it now lands here, with Tasks/Vibe one click away in the rail.
 *   Pulls from the same hooks the rest of the dashboard uses, so nothing
 *   here adds new GitHub polling — it rides existing caches.
 */
"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Hammer,
  Inbox,
  Layers,
  LayoutGrid,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@dashboard/ui/card";
import { useKodyTasks } from "../hooks";
import { useDuties } from "../hooks/useDuties";
import { useStaff } from "../hooks/useStaff";
import { cn } from "../utils";
import type { ColumnId, KodyTask } from "../types";

/** Lane → label + color, for the count tiles and the recent-task chips. */
const COLUMN_META: Record<ColumnId, { label: string; tint: string }> = {
  open: { label: "Backlog", tint: "text-zinc-300 bg-white/[0.06]" },
  building: { label: "Building", tint: "text-amber-300 bg-amber-500/10" },
  review: { label: "In review", tint: "text-sky-300 bg-sky-500/10" },
  failed: { label: "Failed", tint: "text-rose-300 bg-rose-500/10" },
  "gate-waiting": { label: "Gate", tint: "text-violet-300 bg-violet-500/10" },
  retrying: { label: "Retrying", tint: "text-amber-300 bg-amber-500/10" },
  done: { label: "Done", tint: "text-emerald-300 bg-emerald-500/10" },
};

const ACTIVE_COLUMNS: readonly ColumnId[] = [
  "building",
  "retrying",
  "gate-waiting",
];

function countBy(tasks: KodyTask[], cols: readonly ColumnId[]): number {
  return tasks.filter((t) => cols.includes(t.column)).length;
}

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tint: string;
  href: string;
}

function StatTile({ icon: Icon, label, value, tint, href }: StatTileProps) {
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

interface QuickLinkProps {
  icon: LucideIcon;
  label: string;
  description: string;
  href: string;
  tint: string;
}

function QuickLink({ icon: Icon, label, description, href, tint }: QuickLinkProps) {
  return (
    <Link href={href} className="block">
      <Card className="p-4 hover:bg-white/[0.04] transition-colors h-full">
        <span
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md mb-3",
            tint,
          )}
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {description}
        </div>
      </Card>
    </Link>
  );
}

export function DashboardHome() {
  // refetchInterval "idle" — this is a read-only landing, not the live board,
  // so it polls slowly and leans on the shared task cache.
  const { data: tasks, isLoading } = useKodyTasks({ refetchInterval: "idle" });
  const { data: duties } = useDuties();
  const { data: staff } = useStaff();

  const all = tasks ?? [];
  const active = countBy(all, ACTIVE_COLUMNS);
  const review = countBy(all, ["review"]);
  const failed = countBy(all, ["failed"]);
  const backlog = countBy(all, ["open"]);

  const recent = [...all]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-6 space-y-8">
        {/* Lane counts — each links into the Tasks board. */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-3">
            Tasks
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={Hammer}
              label="Active"
              value={isLoading ? "—" : active}
              tint={COLUMN_META.building.tint}
              href="/tasks"
            />
            <StatTile
              icon={Activity}
              label="In review"
              value={isLoading ? "—" : review}
              tint={COLUMN_META.review.tint}
              href="/tasks"
            />
            <StatTile
              icon={AlertTriangle}
              label="Failed"
              value={isLoading ? "—" : failed}
              tint={COLUMN_META.failed.tint}
              href="/tasks"
            />
            <StatTile
              icon={Inbox}
              label="Backlog"
              value={isLoading ? "—" : backlog}
              tint={COLUMN_META.open.tint}
              href="/tasks"
            />
          </div>
        </section>

        {/* Quick links — the surfaces a user jumps to from the overview. */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-3">
            Jump to
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <QuickLink
              icon={LayoutGrid}
              label="Tasks"
              description="Pipelines, tasks, and run health."
              href="/tasks"
              tint="text-emerald-300 bg-emerald-500/10"
            />
            <QuickLink
              icon={Sparkles}
              label="Vibe"
              description="Chat-driven preview — approve and ship."
              href="/vibe"
              tint="text-fuchsia-300 bg-fuchsia-500/10"
            />
            <QuickLink
              icon={Layers}
              label={`Duties${duties ? ` · ${duties.length}` : ""}`}
              description="Recurring work your staff runs."
              href="/duties"
              tint="text-amber-300 bg-amber-500/10"
            />
            <QuickLink
              icon={Users}
              label={`Staff${staff ? ` · ${staff.length}` : ""}`}
              description="Personas that execute your duties."
              href="/staff"
              tint="text-violet-300 bg-violet-500/10"
            />
          </div>
        </section>

        {/* Recently updated tasks. */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Recent activity
            </h2>
            <Link
              href="/tasks"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : recent.length === 0 ? (
            <Card className="p-6 text-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-300 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No tasks yet. Start one from the Tasks board or chat with Kody.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-white/[0.04] overflow-hidden">
              {recent.map((t) => {
                const meta = COLUMN_META[t.column];
                return (
                  <Link
                    key={t.id}
                    href={`/${t.issueNumber}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-12">
                      #{t.issueNumber}
                    </span>
                    <span className="text-sm flex-1 truncate">{t.title}</span>
                    <span
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full shrink-0",
                        meta.tint,
                      )}
                    >
                      {meta.label}
                    </span>
                  </Link>
                );
              })}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
