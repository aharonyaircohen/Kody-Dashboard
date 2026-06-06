/**
 * @fileType component
 * @domain kody
 * @pattern master-detail
 * @ai-summary The Jobs page — a job is the engine's execution unit, assembling
 * executable (how) + duty (why) + staff (who) + schedule (when) into one run.
 * Mirrors DutyControl / ReportsView: master/detail (a searchable list aside +
 * a detail pane), with a back button on mobile. Run lives on the job (row +
 * detail). "New job" opens a dialog to assemble one. The composed shape matches
 * the engine `Job` (see src/dashboard/lib/kody-job.ts).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Rocket,
  Play,
  Plus,
  RefreshCw,
  Loader2,
  User,
  Zap,
  CalendarClock,
  ArrowLeft,
  ExternalLink,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@dashboard/ui/button";
import { Label } from "@dashboard/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { cn } from "../utils";
import { kodyApi, type DutySchedule, type Duty } from "../api";
import { useDuties, useRunDuty, useDeleteDuty } from "../hooks/useDuties";
import { useStaff } from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { validateKodyJob, resolveJobProfile, type KodyJob } from "../kody-job";

interface ExecutableSummary {
  slug: string;
  describe?: string;
}

const SCHEDULE_OPTIONS: DutySchedule[] = [
  "15m",
  "30m",
  "1h",
  "2h",
  "6h",
  "12h",
  "1d",
  "3d",
  "7d",
  "manual",
];

function useExecutables() {
  return useQuery({
    queryKey: ["kody-executables-list"],
    queryFn: async (): Promise<ExecutableSummary[]> => {
      const res = await fetch("/api/kody/executables", {
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { executables?: ExecutableSummary[] };
      return data.executables ?? [];
    },
  });
}

export function JobsManager() {
  const {
    data: jobs = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useDuties();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingRun, setPendingRun] = useState<Duty | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Duty | null>(null);
  const { githubUser } = useGitHubIdentity();
  const run = useRunDuty();
  const remove = useDeleteDuty(githubUser?.login);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.slug.toLowerCase().includes(q) ||
        j.title.toLowerCase().includes(q) ||
        (j.staff?.toLowerCase().includes(q) ?? false),
    );
  }, [jobs, search]);

  const selected = useMemo(
    () => jobs.find((j) => j.slug === selectedSlug) ?? null,
    [jobs, selectedSlug],
  );

  useEffect(() => {
    if (selectedSlug || filtered.length === 0) return;
    setSelectedSlug(filtered[0].slug);
  }, [filtered, selectedSlug]);

  return (
    <>
      <MasterDetailShell
        title="Jobs"
        icon={Rocket}
        iconClassName="text-emerald-400"
        subtitle={`${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
        error={
          error ? `Failed to load jobs: ${(error as Error).message}` : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search jobs…"
        searchAriaLabel="Search jobs"
        accent="emerald"
        listWidth="md:w-96"
        hasSelection={!!selected}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh jobs"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreating(true)}
              title="New job"
              aria-label="New job"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </>
        }
        detail={
          selected ? (
            <JobDetail
              job={selected}
              onBack={() => setSelectedSlug(null)}
              onRun={() => setPendingRun(selected)}
              onDelete={() => setPendingDelete(selected)}
              isRunning={run.isPending && run.variables?.slug === selected.slug}
            />
          ) : (
            <EmptyState
              icon={<Rocket />}
              title="Select a job"
              hint="Pick a job from the list to see its assembly and run it."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Rocket />} title="Loading jobs…" />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Rocket />}
            title="No jobs yet"
            hint="A job binds an executable, a duty, a staff member, and a schedule. Click “New job” to assemble one."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Rocket />}
            title="No matching jobs"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((job) => (
              <li key={job.slug}>
                <JobRow
                  job={job}
                  isActive={selectedSlug === job.slug}
                  onSelect={() => setSelectedSlug(job.slug)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
            <DialogDescription>
              Assemble a run from executable, duty, staff, and schedule.
            </DialogDescription>
          </DialogHeader>
          <JobComposer onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRun}
        title={`Run “${pendingRun?.title ?? ""}” now?`}
        description="Posts the dispatch comment so the engine starts a run immediately, instead of waiting for the schedule."
        confirmLabel="Run now"
        onConfirm={() => {
          if (pendingRun) run.mutate({ slug: pendingRun.slug, force: true });
          setPendingRun(null);
        }}
        onClose={() => setPendingRun(null)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.title ?? ""}”?`}
        description="Removes the job from .kody/duties/ via a commit on the default branch. Past runs are not affected."
        variant="destructive"
        confirmLabel="Delete job"
        onConfirm={() => {
          if (pendingDelete) {
            const slug = pendingDelete.slug;
            remove.mutate(slug);
            if (selectedSlug === slug) setSelectedSlug(null);
          }
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}

/** One job in the list — mirrors ReportRow / the duty list row. */
function JobRow({
  job,
  isActive,
  onSelect,
}: {
  job: Duty;
  isActive: boolean;
  onSelect: () => void;
}) {
  const scheduled = job.schedule && job.schedule !== "manual";
  // The leading icon IS the type: a clock for scheduled jobs (auto-fire on a
  // cadence), a lightning bolt for action jobs (run on demand only).
  const TypeIcon = scheduled ? CalendarClock : Zap;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
        isActive && "bg-accent/70",
        job.disabled && "opacity-60",
      )}
    >
      {isActive ? (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
      ) : null}
      <div className="flex items-center gap-2">
        <TypeIcon
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            scheduled ? "text-sky-400" : "text-violet-400",
          )}
          aria-label={scheduled ? `Scheduled · ${job.schedule}` : "Action"}
        />
        <span className="text-sm truncate flex-1 font-medium">
          {job.title || job.slug}
        </span>
        {job.disabled ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-400/80">
            paused
          </span>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
        <span className="font-mono opacity-80">{job.slug}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          {job.staff || "kody"}
        </span>
      </div>
    </button>
  );
}

/** Detail pane — the job's assembly + run status, mirroring DutyDetail. */
function JobDetail({
  job,
  onBack,
  onRun,
  onDelete,
  isRunning,
}: {
  job: Duty;
  onBack: () => void;
  onRun: () => void;
  onDelete: () => void;
  isRunning: boolean;
}) {
  const scheduled = job.schedule && job.schedule !== "manual";
  const lastRun = job.lastTickAt
    ? `${job.lastOutcome ?? "ran"} · ${new Date(job.lastTickAt).toLocaleDateString()}`
    : "never run";
  const nextRun =
    !job.disabled && job.nextEligibleAt
      ? new Date(job.nextEligibleAt).toLocaleString()
      : scheduled
        ? "—"
        : "manual";
  return (
    <div className="flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-4 md:px-6 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={onBack}
          aria-label="Back to list"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-base font-semibold truncate flex-1">
          {job.title || job.slug}
        </h2>
        <Button
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="w-9 px-0 bg-emerald-600 hover:bg-emerald-700 text-white"
          title="Run job"
          aria-label="Run job"
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="w-9 px-0"
          title="Edit in Duties"
        >
          <Link href="/duties" aria-label="Edit in Duties">
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="w-9 px-0 text-red-400"
          title="Delete job"
          aria-label="Delete job"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Axis label="When" value={scheduled ? job.schedule! : "manual"} />
          <Axis label="Who" value={job.staff || "kody"} />
          <Axis label="Status" value={job.disabled ? "paused" : "active"} />
          <Axis label="Last run" value={lastRun} />
          <Axis label="Next run" value={nextRun} />
        </div>

        {job.body ? (
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
              Intent
            </div>
            <pre className="text-sm text-white/80 whitespace-pre-wrap break-words font-sans">
              {job.body}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Axis({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

/** Create panel — assemble a new job from the four axes (inside the dialog). */
function JobComposer({ onDone }: { onDone: () => void }) {
  const { githubUser } = useGitHubIdentity();
  const login = githubUser?.login;

  const { data: executables = [] } = useExecutables();
  const { data: duties = [] } = useDuties();
  const { data: staff = [] } = useStaff();

  const [executable, setExecutable] = useState("");
  const [duty, setDuty] = useState("");
  const [persona, setPersona] = useState("");
  const [schedule, setSchedule] = useState<DutySchedule>("1d");
  const [why, setWhy] = useState("");

  // The form only DEFINES (saves) a job — running is done from the list. Every
  // saved job is a scheduled duty; "manual" just means it has no auto-cadence.
  const { job, error } = useMemo(() => {
    try {
      const candidate: Record<string, unknown> = {
        executable: executable || undefined,
        duty: duty || undefined,
        why: why || undefined,
        persona: persona || undefined,
        schedule: schedule === "manual" ? undefined : schedule,
        cliArgs: {},
        flavor: "scheduled",
        force: true,
      };
      return { job: validateKodyJob(candidate), error: null as string | null };
    } catch (e) {
      return { job: null, error: (e as Error).message };
    }
  }, [executable, duty, why, persona, schedule]);

  const save = useMutation({
    mutationFn: (j: KodyJob) => {
      const slug = resolveJobProfile(j) ?? "job";
      const intent = j.why?.trim() || `Run ${slug}.`;
      return kodyApi.duties.create({
        title: slug,
        body: `## Job\n\nExecutable: \`${slug}\`\n\n${intent}\n`,
        schedule,
        staff: j.persona || null,
        actorLogin: login,
      });
    },
    onSuccess: () => {
      toast.success("Job created");
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const busy = save.isPending;
  const canSubmit = !!job && !error && !!resolveJobProfile(job);

  const submit = () => {
    if (job) save.mutate(job);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldSelect
          label="Executable — how"
          value={executable}
          onChange={setExecutable}
          placeholder="Select…"
          options={executables.map((e) => e.slug)}
        />
        <FieldSelect
          label="Staff — who"
          value={persona}
          onChange={setPersona}
          placeholder="Select…"
          options={staff.map((s) => s.slug)}
        />
        <FieldSelect
          label="Duty — why (optional)"
          value={duty}
          onChange={setDuty}
          placeholder="None"
          options={duties.map((d) => d.slug)}
        />
        {/* "manual" = saved with no auto-cadence; run it from the list. */}
        <FieldSelect
          label="Schedule — when"
          value={schedule}
          onChange={(v) => setSchedule(v as DutySchedule)}
          options={SCHEDULE_OPTIONS}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="job-why">Intent — free-text why (optional)</Label>
        <textarea
          id="job-why"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          rows={2}
          placeholder="What should this run do?"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      </div>

      {error && <p className="text-xs text-amber-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="gap-2"
          onClick={submit}
          disabled={!canSubmit || busy}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Create job
        </Button>
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
