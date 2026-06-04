/**
 * @fileType component
 * @domain kody
 * @pattern job-composer
 * @ai-summary The Jobs page. A job is the engine's unified execution unit — it
 * ASSEMBLES the four reusable nouns into one runnable thing:
 *   executable (HOW) + duty (WHY) + staff/persona (WHO) + schedule (WHEN).
 * This composer binds all four, shows the assembled job, and dispatches it:
 *   - instant   → runs now via `@kody <executable>` (POST /api/kody/jobs)
 *   - scheduled → persists as a duty (staff + schedule + intent)
 * The shape matches the engine `Job` exactly (see src/dashboard/lib/kody-job.ts).
 */
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap, CalendarClock, Play, Save, Loader2 } from "lucide-react";
import { kodyApi, type DutySchedule } from "../api";
import { useDuties } from "../hooks/useDuties";
import { useStaff } from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
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
  const { githubUser } = useGitHubIdentity();
  const login = githubUser?.login;

  const { data: executables = [] } = useExecutables();
  const { data: duties = [] } = useDuties();
  const { data: staff = [] } = useStaff();

  // The four axes + flavor/target/force.
  const [flavor, setFlavor] = useState<KodyJobFlavor>("instant");
  const [executable, setExecutable] = useState(""); // HOW
  const [duty, setDuty] = useState(""); // WHY (slug)
  const [persona, setPersona] = useState(""); // WHO
  const [schedule, setSchedule] = useState<DutySchedule>("1d"); // WHEN
  const [target, setTarget] = useState(""); // issue/PR number
  const [why, setWhy] = useState(""); // WHY (inline)
  const [force, setForce] = useState(true);

  // Assemble the candidate job + surface validation the engine would apply.
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
        force: flavor === "scheduled" ? force : undefined,
      };
      return { job: validateKodyJob(candidate), error: null as string | null };
    } catch (e) {
      return { job: null, error: (e as Error).message };
    }
  }, [executable, duty, why, persona, schedule, target, flavor, force]);

  const runInstant = useMutation({
    mutationFn: (j: KodyJob) => kodyApi.jobs.run(j, login),
    onSuccess: (r) => toast.success(`Ran: ${r.dispatch}`),
    onError: (e) => toast.error((e as Error).message),
  });

  const saveScheduled = useMutation({
    mutationFn: (j: KodyJob) => {
      // A scheduled job's source of truth is a duty: who (staff) + when
      // (schedule) + why (intent body). The executable (how) is named in the
      // body until the duty editor gains a first-class executable field.
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
    onSuccess: () => toast.success("Saved scheduled job as a duty"),
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
    <div className="max-w-3xl mx-auto p-5 md:p-6 space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-white/90">Jobs</h1>
        <p className="text-sm text-white/50 mt-1">
          A job assembles an{" "}
          <span className="text-white/70">executable (how)</span>, a{" "}
          <span className="text-white/70">duty (why)</span>, a{" "}
          <span className="text-white/70">staff member (who)</span>, and a{" "}
          <span className="text-white/70">schedule (when)</span> into one run.
        </p>
      </header>

      {/* Flavor: instant vs scheduled = the "when" */}
      <div className="flex gap-2">
        {(["instant", "scheduled"] as const).map((f) => {
          const Icon = f === "scheduled" ? CalendarClock : Zap;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFlavor(f)}
              className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                flavor === f
                  ? "border-white/20 bg-white/[0.1] text-white"
                  : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white/80"
              }`}
            >
              <Icon className="w-4 h-4" />
              {f === "instant" ? "Instant — run now" : "Scheduled — recurring"}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Executable — how">
          <Select value={executable} onChange={setExecutable}>
            <option value="">Select executable…</option>
            {executables.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.slug}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Staff — who">
          <Select value={persona} onChange={setPersona}>
            <option value="">
              {flavor === "instant" ? "kody (default)" : "Select staff…"}
            </option>
            {staff.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.slug}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Duty — why (optional reference)">
          <Select value={duty} onChange={setDuty}>
            <option value="">None</option>
            {duties.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.slug}
              </option>
            ))}
          </Select>
        </Field>

        {flavor === "scheduled" ? (
          <Field label="Schedule — when">
            <Select
              value={schedule}
              onChange={(v) => setSchedule(v as DutySchedule)}
            >
              {SCHEDULE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Target — issue/PR number">
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 42"
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/90 outline-none focus:border-white/20"
            />
          </Field>
        )}
      </div>

      <Field label="Intent — free-text why (optional)">
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          rows={2}
          placeholder="What should this run do?"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/90 outline-none focus:border-white/20 resize-none"
        />
      </Field>

      {flavor === "scheduled" && (
        <label className="flex items-center gap-2 text-sm text-white/60">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          Force-run (bypass the cadence guard)
        </label>
      )}

      {/* Assembled job preview */}
      <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
        <div className="text-xs uppercase tracking-wide text-white/40 mb-1">
          Assembled job
        </div>
        {error ? (
          <div className="text-sm text-amber-400">{error}</div>
        ) : (
          <code className="text-xs text-white/70 whitespace-pre-wrap break-words">
            {flavor === "instant" && job
              ? renderInstantJobComment(job)
              : JSON.stringify(job, null, 2)}
          </code>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || busy}
        className="inline-flex items-center gap-2 rounded-lg bg-white/[0.1] hover:bg-white/[0.16] disabled:opacity-40 px-4 py-2 text-sm font-medium text-white transition-colors"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : flavor === "instant" ? (
          <Play className="w-4 h-4" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {flavor === "instant" ? "Run job" : "Save scheduled job"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-white/50 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/90 outline-none focus:border-white/20"
    >
      {children}
    </select>
  );
}
