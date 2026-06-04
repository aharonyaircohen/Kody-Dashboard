/**
 * @fileType component
 * @domain kody
 * @pattern job-list
 * @ai-summary The Jobs page. A job is the engine's execution unit — it
 * assembles an executable (how) + duty (why) + staff (who) + schedule (when)
 * into one run. LIST-FIRST: every defined job is a row you Run on the spot;
 * "New job" opens a dialog to assemble one. Built from the shared page shell
 * (PageShell / Button / ConfirmDialog / Dialog / Select) for visual parity with
 * Duties and Staff. The composed shape matches the engine `Job`
 * (see src/dashboard/lib/kody-job.ts).
 */
"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
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
import { useDuties, useRunDuty } from "../hooks/useDuties";
import { useStaff } from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { PageHeader } from "./PageShell";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  validateKodyJob,
  resolveJobProfile,
  type KodyJob,
  type KodyJobFlavor,
} from "../kody-job";

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
  const { data: jobs = [], isLoading, isFetching, refetch } = useDuties();
  const [creating, setCreating] = useState(false);
  const [pendingRun, setPendingRun] = useState<Duty | null>(null);
  const run = useRunDuty();

  return (
    <div className="h-full min-h-0 flex flex-col bg-black/95 text-white/90">
      <PageHeader
        title="Jobs"
        icon={Rocket}
        iconClassName="text-emerald-400"
        subtitle={`${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
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
              className="gap-1"
              onClick={() => setCreating(true)}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New job</span>
            </Button>
          </>
        }
      />

      <main className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-muted-foreground mb-3">
            A job binds an executable (how), a duty (why), a staff member (who),
            and a schedule (when). Run any one now, or it fires on its schedule.
          </p>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Loading jobs…
            </p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No jobs yet. Click “New job” to assemble one.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {jobs.map((job) => (
                <JobRow
                  key={job.slug}
                  job={job}
                  running={run.isPending && run.variables?.slug === job.slug}
                  onRun={() => setPendingRun(job)}
                />
              ))}
            </ul>
          )}
        </div>
      </main>

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
    </div>
  );
}

/** One job in the list — its assembly at a glance, with Run on the row. */
function JobRow({
  job,
  running,
  onRun,
}: {
  job: Duty;
  running: boolean;
  onRun: () => void;
}) {
  const scheduled = job.schedule && job.schedule !== "manual";
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors",
        job.disabled && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {job.title || job.slug}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <span className="font-mono opacity-80">{job.slug}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            {scheduled ? (
              <CalendarClock className="w-3 h-3" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {scheduled ? job.schedule : "manual"}
          </span>
          <span className="inline-flex items-center gap-1">
            <User className="w-3 h-3" />
            {job.staff || "kody"}
          </span>
          {job.disabled && <span className="text-amber-400/80">paused</span>}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onRun}
        disabled={running}
        className="shrink-0 gap-1.5"
        title="Run this job now"
      >
        {running ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        Run
      </Button>
    </li>
  );
}

/** Create panel — assemble a new job from the four axes. */
function JobComposer({ onDone }: { onDone: () => void }) {
  const { githubUser } = useGitHubIdentity();
  const login = githubUser?.login;

  const { data: executables = [] } = useExecutables();
  const { data: duties = [] } = useDuties();
  const { data: staff = [] } = useStaff();

  const [flavor, setFlavor] = useState<KodyJobFlavor>("scheduled");
  const [executable, setExecutable] = useState("");
  const [duty, setDuty] = useState("");
  const [persona, setPersona] = useState("");
  const [schedule, setSchedule] = useState<DutySchedule>("1d");
  const [target, setTarget] = useState("");
  const [why, setWhy] = useState("");

  const { job, error } = useMemo(() => {
    try {
      const candidate: Record<string, unknown> = {
        executable: executable || undefined,
        duty: duty || undefined,
        why: why || undefined,
        persona: persona || undefined,
        schedule: flavor === "scheduled" ? schedule : undefined,
        target: target ? Number(target) : undefined,
        cliArgs: {},
        flavor,
        force: flavor === "scheduled" ? true : undefined,
      };
      return { job: validateKodyJob(candidate), error: null as string | null };
    } catch (e) {
      return { job: null, error: (e as Error).message };
    }
  }, [executable, duty, why, persona, schedule, target, flavor]);

  const runInstant = useMutation({
    mutationFn: (j: KodyJob) => kodyApi.jobs.run(j, login),
    onSuccess: (r) => {
      toast.success(`Ran: ${r.dispatch}`);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveScheduled = useMutation({
    mutationFn: (j: KodyJob) => {
      const slug = resolveJobProfile(j) ?? "job";
      const intent =
        j.why?.trim() || `Run ${resolveJobProfile(j)} on schedule.`;
      return kodyApi.duties.create({
        title: `${slug} (scheduled)`,
        body: `## Job\n\nExecutable: \`${resolveJobProfile(j)}\`\n\n${intent}\n`,
        schedule: (j.schedule as DutySchedule) ?? null,
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

  const busy = runInstant.isPending || saveScheduled.isPending;
  const canSubmit =
    !!job &&
    !error &&
    !!resolveJobProfile(job) &&
    (flavor === "instant" ? !!job.target : true);

  const submit = () => {
    if (!job) return;
    if (flavor === "instant") runInstant.mutate(job);
    else saveScheduled.mutate(job);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["scheduled", "instant"] as const).map((f) => {
          const Icon = f === "scheduled" ? CalendarClock : Zap;
          return (
            <Button
              key={f}
              type="button"
              variant={flavor === f ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setFlavor(f)}
            >
              <Icon className="w-4 h-4" />
              {f === "scheduled" ? "Recurring" : "Run once now"}
            </Button>
          );
        })}
      </div>

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
          placeholder={flavor === "instant" ? "kody (default)" : "Select…"}
          options={staff.map((s) => s.slug)}
        />
        <FieldSelect
          label="Duty — why (optional)"
          value={duty}
          onChange={setDuty}
          placeholder="None"
          options={duties.map((d) => d.slug)}
        />
        {flavor === "scheduled" ? (
          <FieldSelect
            label="Schedule — when"
            value={schedule}
            onChange={(v) => setSchedule(v as DutySchedule)}
            options={SCHEDULE_OPTIONS}
          />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="job-target">Target — issue/PR #</Label>
            <Input
              id="job-target"
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 42"
            />
          </div>
        )}
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
          ) : flavor === "instant" ? (
            <Play className="w-4 h-4" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {flavor === "instant" ? "Run now" : "Create job"}
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
