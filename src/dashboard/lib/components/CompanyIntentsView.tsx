/**
 * @fileType component
 * @domain kody
 * @pattern company-intents
 * @ai-summary Operator view for CTO agency-architect intents.
 */
"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CalendarClock,
  CircleDot,
  Compass,
  Edit3,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";

import { Badge } from "@dashboard/ui/badge";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Label } from "@dashboard/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils/ui";
import { selectionPath } from "../selection-routing";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import {
  companyIntentWarnings,
  isCompanyIntentId,
  slugifyCompanyIntentId,
  type CompanyIntent,
  type CompanyIntentDecisionLog,
  type CompanyIntentInput,
  type CompanyIntentPosture,
  type CompanyIntentRecord,
  type CompanyIntentStatus,
} from "../company-intents";
import {
  useCompanyIntents,
  useCreateCompanyIntent,
  useRunCompanyIntent,
  useUpdateCompanyIntent,
} from "../hooks/useCompanyIntents";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { EmptyState } from "./EmptyState";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { MasterDetailShell } from "./MasterDetailShell";
import { RepoScopedLink } from "./RepoScopedLink";

type IntentFormState = {
  id: string;
  for: string;
  description: string;
  priority: string;
  status: CompanyIntentStatus;
  posture: CompanyIntentPosture;
  repos: string;
  areas: string;
  principles: string;
  metrics: string;
  releaseCadence: "manual" | "1d" | "1w";
  qaDepth: "light" | "standard" | "strict";
  blockerLevel: "low" | "standard" | "strict";
  approval: "none" | "before-production" | "before-risky-actions";
  maxConcurrentGoals: string;
  maxDailyActions: string;
  requiresHumanFor: string;
  goals: string;
  loops: string;
  capabilities: string;
  reviewEvery: "1d" | "1w";
};

type IntentFormSetter = Dispatch<SetStateAction<IntentFormState>>;
type IntentBehavior = "cautious" | "balanced" | "fast";

const behaviorOptions: Array<{
  id: IntentBehavior;
  label: string;
  defaults: Partial<IntentFormState>;
}> = [
  {
    id: "cautious",
    label: "Cautious",
    defaults: {
      posture: "confidence",
      qaDepth: "strict",
      blockerLevel: "strict",
      approval: "before-risky-actions",
      maxConcurrentGoals: "1",
      maxDailyActions: "3",
      principles:
        "Verify before risky action\nPrefer waiting over unsafe action",
      requiresHumanFor: "production approval\nhigh-risk decisions",
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    defaults: {
      posture: "balanced",
      qaDepth: "standard",
      blockerLevel: "standard",
      approval: "before-risky-actions",
      maxConcurrentGoals: "1",
      maxDailyActions: "5",
      principles: "Keep work useful, verified, and low-friction",
    },
  },
  {
    id: "fast",
    label: "Fast",
    defaults: {
      posture: "speed",
      qaDepth: "light",
      blockerLevel: "low",
      approval: "before-production",
      maxConcurrentGoals: "2",
      maxDailyActions: "10",
      principles: "Move quickly when risk is low",
    },
  },
];

export function CompanyIntentsView({
  selectedId = null,
}: {
  selectedId?: string | null;
} = {}) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const { data, error, isFetching, isLoading, refetch } = useCompanyIntents();
  const createIntent = useCreateCompanyIntent();
  const updateIntent = useUpdateCompanyIntent();
  const runIntent = useRunCompanyIntent();
  const [query, setQuery] = useState("");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<IntentFormState>(emptyForm());

  const intents = useMemo(() => data ?? [], [data]);
  const intentsLoaded = data !== undefined;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return intents;
    return intents.filter(({ id, intent }) =>
      [
        id,
        intent.for,
        intent.description ?? "",
        intent.status,
        intent.posture,
        intent.manager.agent,
        ...intent.scope.repos,
        ...intent.scope.areas,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [intents, query]);

  useEffect(() => {
    if (isLoading || !intentsLoaded) return;
    if (filtered.length === 0) {
      if (selectedId) router.replace(scopedHref("/company-intents"));
      return;
    }
    if (selectedId && !filtered.some((record) => record.id === selectedId)) {
      router.replace(scopedHref("/company-intents"));
      return;
    }
    if (!selectedId && autoSelectFirst) {
      router.replace(
        scopedHref(selectionPath("/company-intents", filtered[0]!.id)),
      );
    }
  }, [
    autoSelectFirst,
    filtered,
    intentsLoaded,
    isLoading,
    router,
    scopedHref,
    selectedId,
  ]);

  const selectIntent = (id: string | null, replace = false) => {
    const path = id
      ? selectionPath("/company-intents", id)
      : "/company-intents";
    if (replace) router.replace(scopedHref(path));
    else router.push(scopedHref(path));
  };

  const selected = selectedId
    ? (filtered.find((record) => record.id === selectedId) ?? null)
    : null;

  const activeCount = intents.filter(
    (record) => record.intent.status === "active",
  ).length;
  const warningCount = intents.reduce(
    (sum, record) =>
      sum + companyIntentWarnings(record.intent, record.managerHealth).length,
    0,
  );

  function openCreate() {
    setForm(emptyForm());
    setFormMode("create");
  }

  function openEdit(record: CompanyIntentRecord) {
    setForm(recordToForm(record));
    setFormMode("edit");
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    const input = formToInput(form);
    if (formMode === "create") {
      const created = await createIntent.mutateAsync(input);
      selectIntent(created.id);
    } else if (formMode === "edit" && selected) {
      const updated = await updateIntent.mutateAsync({
        id: selected.id,
        data: input,
      });
      selectIntent(updated.id);
    }
    setFormMode(null);
  }

  async function setLifecycle(status: CompanyIntentStatus) {
    if (!selected) return;
    const updated = await updateIntent.mutateAsync({
      id: selected.id,
      data: { status },
    });
    selectIntent(updated.id);
  }

  const formIdValid = !form.id || isCompanyIntentId(form.id);
  const formCanSubmit =
    formIdValid &&
    form.for.trim().length > 0 &&
    !createIntent.isPending &&
    !updateIntent.isPending;

  return (
    <>
      <MasterDetailShell
        title="Intents"
        icon={Compass}
        iconClassName="text-cyan-400"
        subtitle={`${intents.length} ${intents.length === 1 ? "intent" : "intents"} · ${activeCount} active · ${warningCount} warnings`}
        error={
          error ? `Failed to load intents: ${(error as Error).message}` : null
        }
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search intents"
        searchAriaLabel="Search intents"
        accent="sky"
        listWidth="md:w-80"
        hasSelection={!!selected}
        listAside={
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{filtered.length} shown</span>
            {isFetching ? <span>Updating</span> : null}
          </div>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh intents"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={openCreate}
              title="New intent"
              aria-label="New intent"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selected ? (
            <IntentDetail
              record={selected}
              running={runIntent.isPending}
              updating={updateIntent.isPending}
              onBack={() => selectIntent(null)}
              onEdit={() => openEdit(selected)}
              onRun={() => runIntent.mutate(selected.id)}
              onLifecycle={setLifecycle}
            />
          ) : (
            <EmptyState
              icon={<Compass />}
              title="Select an intent"
              hint="Inspect CTO guidance, health, and decision history."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<FileText />} title="Loading intents..." />
        ) : intents.length === 0 ? (
          <EmptyState
            icon={<CircleDot />}
            title="No intents"
            hint="Create the first AI Agency manager intent."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New intent
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No matching intents"
            hint={`Nothing matched "${query}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((record) => (
              <li key={record.id}>
                <IntentListItem
                  record={record}
                  selected={record.id === selected?.id}
                  onSelect={() => selectIntent(record.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <Dialog
        open={formMode !== null}
        onOpenChange={(open) => !open && setFormMode(null)}
      >
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {formMode === "create" ? "New intent" : "Edit intent"}
            </DialogTitle>
            <DialogDescription>
              Set the intent and behavior Kody should use for this repo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <IntentSimpleFields
                form={form}
                setForm={setForm}
                formIdValid={formIdValid}
                autoSlug={formMode === "create"}
              />
            </div>

            <div className="mt-5 flex shrink-0 justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormMode(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!formCanSubmit}>
                {createIntent.isPending || updateIntent.isPending ? (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {formMode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IntentSimpleFields({
  form,
  setForm,
  formIdValid,
  autoSlug,
}: {
  form: IntentFormState;
  setForm: IntentFormSetter;
  formIdValid: boolean;
  autoSlug: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="space-y-5">
        <Field label="What should Kody care about?">
          <Textarea
            value={form.for}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                for: event.target.value,
                ...(autoSlug
                  ? { id: slugifyCompanyIntentId(event.target.value) }
                  : {}),
              }))
            }
            onBlur={() =>
              setForm((prev) => ({
                ...prev,
                id:
                  autoSlug && !prev.id
                    ? slugifyCompanyIntentId(prev.for)
                    : prev.id,
              }))
            }
            placeholder="Keep releases healthy without unnecessary work."
            className="min-h-28"
          />
          {!formIdValid ? (
            <p className="mt-1 text-body-xs text-destructive">
              The generated ID needs lowercase letters, numbers, and dashes.
            </p>
          ) : null}
        </Field>

        <Field label="Behavior">
          <Select
            value={behaviorFromPosture(form.posture)}
            onValueChange={(behavior: IntentBehavior) =>
              setForm((prev) => applyBehaviorDefaults(prev, behavior))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {behaviorOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="More context">
        <MarkdownEditor
          value={form.description}
          onChange={(value) =>
            setForm((prev) => ({
              ...prev,
              description: value,
            }))
          }
          rows={16}
          placeholder="Explain why this matters, what good looks like, and any edge cases."
          textareaClassName="min-h-[360px]"
          emptyPreview="No context yet."
        />
      </Field>
    </div>
  );
}

function IntentListItem({
  record,
  selected,
  onSelect,
}: {
  record: CompanyIntentRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const warnings = companyIntentWarnings(record.intent, record.managerHealth);
  const tone = intentStatusTone(record.intent.status);
  const behavior = behaviorFromPosture(record.intent.posture);
  return (
    <div
      className={cn(
        "relative flex items-stretch transition-colors",
        tone.rowClass,
        selected && tone.selectedClass,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Compass className={cn("h-3.5 w-3.5 shrink-0", tone.iconClass)} />
          <span className="flex-1 truncate font-mono text-sm text-white/90">
            {record.id}
          </span>
          <StatusBadge status={record.intent.status} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{behaviorLabel(behavior)}</span>
          {warnings.length ? (
            <>
              <span>·</span>
              <span>{warnings.length} warnings</span>
            </>
          ) : null}
        </div>

        <p className="mt-1 line-clamp-2 text-xs text-white/55">
          {record.intent.for || "No intent target"}
        </p>
        {record.intent.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-white/40">
            {record.intent.description}
          </p>
        ) : null}
      </button>
    </div>
  );
}

function IntentDetail({
  record,
  running,
  updating,
  onBack,
  onEdit,
  onRun,
  onLifecycle,
}: {
  record: CompanyIntentRecord;
  running: boolean;
  updating: boolean;
  onBack: () => void;
  onEdit: () => void;
  onRun: () => void;
  onLifecycle: (status: CompanyIntentStatus) => void;
}) {
  const { intent, decisions, managerHealth } = record;
  const warnings = companyIntentWarnings(intent, managerHealth);
  const behavior = behaviorFromPosture(intent.posture);
  const advancedCount = warnings.length + decisions.length;
  return (
    <article className="min-h-full">
      <div className="border-b border-border bg-card/20">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 gap-1 text-muted-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            All intents
          </Button>

          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="inline-flex flex-wrap items-center gap-3 break-words text-2xl font-semibold tracking-tight md:text-3xl">
                <span>Intent</span>
                <StatusBadge status={intent.status} />
                <span className="rounded bg-white/[0.06] px-2 py-0.5 font-sans text-[11px] uppercase tracking-wide text-white/50">
                  {behaviorLabel(behavior)}
                </span>
              </h1>
              <p className="break-words text-xs text-muted-foreground">
                {intent.id}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRun}
                disabled={running || intent.status !== "active"}
                className="h-8 w-8 px-0"
                title="Review now"
                aria-label="Review now"
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-8 w-8 px-0"
                title="Edit intent"
                aria-label="Edit intent"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              {intent.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onLifecycle("paused")}
                  disabled={updating}
                  className="h-8 w-8 px-0"
                  title="Pause intent"
                  aria-label="Pause intent"
                >
                  {updating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onLifecycle("active")}
                  disabled={updating}
                  className="h-8 w-8 px-0"
                  title="Activate intent"
                  aria-label="Activate intent"
                >
                  {updating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              {intent.status !== "archived" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onLifecycle("archived")}
                  disabled={updating}
                  className="h-8 w-8 px-0"
                  title="Archive intent"
                  aria-label="Archive intent"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </header>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
        <section className="rounded-xl border border-white/[0.08] bg-black/20 p-4 md:p-5">
          <div>
            <div className="text-body-xs font-medium uppercase tracking-wide text-white/45">
              What Kody should care about
            </div>
            <p className="break-words text-sm text-white/80">
              {intent.for || "No intent target"}
            </p>
          </div>

          {intent.description ? (
            <div className="mt-5 border-t border-white/[0.08] pt-4">
              <div className="mb-2 text-body-xs font-medium uppercase tracking-wide text-white/45">
                More context
              </div>
              <MarkdownPreview content={intent.description} variant="compact" />
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <PlainFact label="Behavior" value={behaviorLabel(behavior)} />
          <PlainFact label="Status" value={intent.status} />
          <PlainFact
            label="Last reviewed"
            value={formatDate(intent.manager.lastReviewedAt)}
          />
        </section>

        <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="text-body-xs font-medium uppercase tracking-wide text-white/45">
            What Kody is doing
          </div>
          <p className="mt-2 text-body-sm text-muted-foreground">
            {intentWorkSummary(intent)}
          </p>
        </section>

        <details className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white/85">
            Advanced
            {advancedCount ? (
              <span className="ml-2 text-xs text-white/40">
                {advancedCount}
              </span>
            ) : null}
          </summary>
          <div className="space-y-6 border-t border-white/[0.06] p-4">
            {warnings.length ? (
              <Block
                title="Warnings"
                subtitle="Setup or runtime issues"
                icon={AlertCircle}
                count={warnings.length}
              >
                <div className="flex flex-wrap gap-2">
                  {warnings.map((warning) => (
                    <Badge
                      key={warning}
                      variant="outline"
                      className="text-amber-600"
                    >
                      {warning}
                    </Badge>
                  ))}
                </div>
              </Block>
            ) : null}

            <Block
              title="Policy"
              subtitle="Behavior limits created by the selected mode"
              icon={ShieldCheck}
            >
              <PolicyGrid intent={intent} />
            </Block>

            <div className="grid gap-6 xl:grid-cols-2">
              <Block
                title="Agency Architect"
                subtitle="Background reviewer wiring"
                icon={Compass}
              >
                <ManagerHealth intent={intent} record={record} />
              </Block>
              <Block
                title="Scope"
                subtitle="Stored targeting and linked work"
                icon={Target}
              >
                <div className="space-y-5">
                  <ChipGroup title="Repos" items={intent.scope.repos} />
                  <ChipGroup title="Areas" items={intent.scope.areas} />
                  <Portfolio intent={intent} />
                </div>
              </Block>
            </div>

            <Block
              title="Principles"
              subtitle="Stored rules used by Agency Architect"
              icon={Compass}
              count={intent.principles.length}
            >
              <TextList items={intent.principles} empty="No principles set." />
            </Block>

            <Block
              title="Metrics"
              subtitle="Stored signals used to judge progress"
              icon={ShieldCheck}
              count={intent.metrics.length}
            >
              <TextList items={intent.metrics} empty="No metrics set." />
            </Block>

            <Block
              title="Decision Log"
              subtitle="Recent Agency Architect decisions"
              icon={CalendarClock}
              count={decisions.length}
            >
              <DecisionLog decisions={decisions} />
            </Block>
          </div>
        </details>
      </div>
    </article>
  );
}

function PlainFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-body-xs font-medium uppercase tracking-wide text-white/40">
        {label}
      </div>
      <div className="mt-1 break-words text-body-sm text-white/85">
        {value}
      </div>
    </div>
  );
}

function intentWorkSummary(intent: CompanyIntent): string {
  const goalCount = intent.portfolio.goals.length;
  const loopCount = intent.portfolio.loops.length;
  if (goalCount === 0 && loopCount === 0) {
    return "No linked work yet. Agency Architect can review this intent and decide whether it needs anything.";
  }

  const parts: string[] = [];
  if (goalCount > 0) {
    parts.push(`${goalCount} ${goalCount === 1 ? "outcome" : "outcomes"}`);
  }
  if (loopCount > 0) {
    parts.push(
      `${loopCount} background ${loopCount === 1 ? "check" : "checks"}`,
    );
  }
  return `Linked to ${parts.join(" and ")}.`;
}

function ManagerHealth({
  intent,
  record,
}: {
  intent: CompanyIntent;
  record: CompanyIntentRecord;
}) {
  const health = record.managerHealth;
  return (
    <dl className="space-y-2 text-body-xs text-muted-foreground">
      <Meta label="Agent" value={intent.manager.agent} />
      <Meta label="Review" value={intent.manager.reviewEvery} />
      <Meta
        label="Loop"
        value={
          health?.loop.exists
            ? `${health.loop.id} (${health.loop.state ?? "ready"})`
            : `${intent.manager.loop} missing`
        }
      />
      <Meta
        label="Capability"
        value={
          health?.capability.exists
            ? `${health.capability.id} ready`
            : `${intent.manager.capability} missing`
        }
      />
      <Meta
        label="Last review"
        value={formatDate(intent.manager.lastReviewedAt)}
      />
    </dl>
  );
}

function PolicyGrid({ intent }: { intent: CompanyIntent }) {
  const release = intent.policy.release;
  const automation = intent.policy.automation;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <PolicyItem label="Release cadence" value={release?.cadence} />
      <PolicyItem label="QA depth" value={release?.qaDepth} />
      <PolicyItem label="Blockers" value={release?.blockerLevel} />
      <PolicyItem label="Approval" value={release?.approval} />
      <PolicyItem
        label="Concurrent goals"
        value={String(automation.maxConcurrentGoals)}
      />
      <PolicyItem
        label="Daily actions"
        value={String(automation.maxDailyActions)}
      />
      <div className="sm:col-span-2 xl:col-span-3">
        <ChipGroup
          title="Human required for"
          items={automation.requiresHumanFor ?? []}
        />
      </div>
    </div>
  );
}

function Portfolio({ intent }: { intent: CompanyIntent }) {
  return (
    <div>
      <h3 className="text-body-sm font-medium">Portfolio</h3>
      <div className="mt-2 space-y-3">
        <LinkedChipGroup
          title="Goals"
          items={intent.portfolio.goals ?? []}
          href="/agent-goals"
        />
        <LinkedChipGroup
          title="Loops"
          items={intent.portfolio.loops ?? []}
          href="/agent-loops"
        />
        <LinkedChipGroup
          title="Capabilities"
          items={intent.portfolio.capabilities ?? []}
          href="/capabilities"
        />
      </div>
    </div>
  );
}

function DecisionLog({ decisions }: { decisions: CompanyIntentDecisionLog[] }) {
  if (decisions.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        No CTO decisions logged yet.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {[...decisions].reverse().map((decision, index) => (
        <li
          key={`${decision.at}-${decision.action}-${index}`}
          className="rounded-md border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{decisionBadge(decision.action)}</Badge>
            <Badge variant="outline">{decision.action}</Badge>
            <span className="text-body-xs text-muted-foreground">
              {formatDate(decision.at)}
            </span>
          </div>
          <p className="mt-2 break-words text-body-sm text-muted-foreground">
            {decision.reason}
          </p>
          {decision.resources?.length ? (
            <div className="mt-3">
              <ChipGroup title="Resources" items={decision.resources} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Block({
  title,
  subtitle,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Compass;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            className="mt-0.5 h-4 w-4 shrink-0 text-sky-300"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-white/90">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {typeof count === "number" ? (
          <span className="shrink-0 text-xs text-white/45">{count}</span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      {children}
    </div>
  );
}

function PolicyItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-body-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-body-sm font-medium">
        {value || "Not set"}
      </div>
    </div>
  );
}

function TextList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-2 text-body-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function ChipGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-body-xs font-medium text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="mt-1 text-body-xs text-muted-foreground">None</div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <Badge
              key={item}
              variant="outline"
              className="max-w-full break-all font-normal"
            >
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedChipGroup({
  title,
  items,
  href,
}: {
  title: string;
  items: string[];
  href: string;
}) {
  return (
    <div>
      <div className="text-body-xs font-medium text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="mt-1 text-body-xs text-muted-foreground">None</div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <RepoScopedLink key={item} href={href} className="max-w-full">
              <Badge
                variant="outline"
                className="max-w-full break-all font-normal hover:bg-card"
              >
                {item}
              </Badge>
            </RepoScopedLink>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CompanyIntentStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-sans text-xs capitalize",
        status === "active" && "border-emerald-500/40 text-emerald-600",
        status === "paused" && "border-amber-500/40 text-amber-600",
        status === "archived" && "border-muted-foreground/30",
      )}
    >
      {status}
    </Badge>
  );
}

function intentStatusTone(status: CompanyIntentStatus): {
  rowClass: string;
  selectedClass: string;
  iconClass: string;
} {
  if (status === "active") {
    return {
      rowClass:
        "border-l-2 border-l-emerald-400/60 bg-emerald-500/[0.025] hover:bg-emerald-500/[0.06]",
      selectedClass: "bg-emerald-500/[0.09]",
      iconClass: "text-emerald-300",
    };
  }
  if (status === "paused") {
    return {
      rowClass:
        "border-l-2 border-l-amber-400/60 bg-amber-500/[0.025] hover:bg-amber-500/[0.06]",
      selectedClass: "bg-amber-500/[0.09]",
      iconClass: "text-amber-300",
    };
  }
  return {
    rowClass:
      "border-l-2 border-l-white/10 bg-white/[0.012] opacity-70 hover:bg-white/[0.035] hover:opacity-90",
    selectedClass: "bg-white/[0.06] opacity-100",
    iconClass: "text-white/35",
  };
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt>{label}</dt>
      <dd className="min-w-0 break-all text-right text-foreground">{value}</dd>
    </div>
  );
}

function emptyForm(): IntentFormState {
  return {
    id: "",
    for: "",
    description: "",
    priority: "100",
    status: "active",
    posture: "balanced",
    repos: "",
    areas: "",
    principles: "",
    metrics: "",
    releaseCadence: "manual",
    qaDepth: "standard",
    blockerLevel: "standard",
    approval: "before-risky-actions",
    maxConcurrentGoals: "1",
    maxDailyActions: "5",
    requiresHumanFor: "",
    goals: "",
    loops: "agency-architect-loop",
    capabilities: "agency-architect",
    reviewEvery: "1d",
  };
}

function behaviorFromPosture(posture: CompanyIntentPosture): IntentBehavior {
  if (posture === "confidence" || posture === "stability-recovery") {
    return "cautious";
  }
  if (posture === "speed") return "fast";
  return "balanced";
}

function behaviorLabel(behavior: IntentBehavior): string {
  return (
    behaviorOptions.find((candidate) => candidate.id === behavior)?.label ??
    "Balanced"
  );
}

function applyBehaviorDefaults(
  form: IntentFormState,
  behavior: IntentBehavior,
): IntentFormState {
  const option =
    behaviorOptions.find((candidate) => candidate.id === behavior) ??
    behaviorOptions[1];
  return {
    ...form,
    ...option.defaults,
  };
}

function recordToForm(record: CompanyIntentRecord): IntentFormState {
  const intent = record.intent;
  return {
    id: intent.id,
    for: intent.for,
    description: intent.description ?? "",
    priority: String(intent.priority),
    status: intent.status,
    posture: intent.posture,
    repos: intent.scope.repos.join("\n"),
    areas: intent.scope.areas.join("\n"),
    principles: intent.principles.join("\n"),
    metrics: intent.metrics.join("\n"),
    releaseCadence: intent.policy.release?.cadence ?? "manual",
    qaDepth: intent.policy.release?.qaDepth ?? "standard",
    blockerLevel: intent.policy.release?.blockerLevel ?? "standard",
    approval: intent.policy.release?.approval ?? "before-risky-actions",
    maxConcurrentGoals: String(intent.policy.automation.maxConcurrentGoals),
    maxDailyActions: String(intent.policy.automation.maxDailyActions),
    requiresHumanFor: intent.policy.automation.requiresHumanFor.join("\n"),
    goals: intent.portfolio.goals.join("\n"),
    loops: intent.portfolio.loops.join("\n"),
    capabilities: intent.portfolio.capabilities.join("\n"),
    reviewEvery: intent.manager.reviewEvery,
  };
}

function formToInput(form: IntentFormState): CompanyIntentInput {
  return {
    id: form.id || slugifyCompanyIntentId(form.for),
    for: form.for.trim(),
    description: form.description.trim(),
    priority: boundedNumber(form.priority, 1, 1000, 100),
    status: form.status,
    posture: form.posture,
    scope: {
      repos: parseLines(form.repos),
      areas: parseLines(form.areas),
    },
    principles: parseLines(form.principles),
    metrics: parseLines(form.metrics),
    policy: {
      release: {
        cadence: form.releaseCadence,
        qaDepth: form.qaDepth,
        blockerLevel: form.blockerLevel,
        approval: form.approval,
      },
      automation: {
        authority: "full-auto",
        maxConcurrentGoals: boundedNumber(form.maxConcurrentGoals, 1, 10, 1),
        maxDailyActions: boundedNumber(form.maxDailyActions, 1, 50, 5),
        requiresHumanFor: parseLines(form.requiresHumanFor),
      },
    },
    portfolio: {
      goals: parseLines(form.goals).filter(isCompanyIntentId),
      loops: parseLines(form.loops).filter(isCompanyIntentId),
      capabilities: parseLines(form.capabilities).filter(isCompanyIntentId),
    },
    manager: {
      reviewEvery: form.reviewEvery,
    },
  };
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boundedNumber(
  value: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function decisionBadge(action: string): string {
  const value = action.toLowerCase();
  if (value.includes("fail")) return "Failed";
  if (value.includes("skip")) return "Skipped";
  if (value.includes("create")) return "Created";
  if (value.includes("update") || value.includes("set")) return "Updated";
  return "Note";
}

function formatDate(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
