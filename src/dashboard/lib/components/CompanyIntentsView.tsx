/**
 * @fileType component
 * @domain kody
 * @pattern company-intents
 * @ai-summary Operator view for CTO company-manager intents.
 */
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Archive,
  CalendarClock,
  Compass,
  Edit3,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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
import { Input } from "@dashboard/ui/input";
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

type IntentFormState = {
  id: string;
  for: string;
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
  responsibilities: string;
  reviewEvery: "1d" | "1w";
};

const postureOptions: CompanyIntentPosture[] = [
  "balanced",
  "confidence",
  "speed",
  "stability-recovery",
  "maintenance",
];

export function CompanyIntentsView() {
  const { data, error, isFetching, isLoading, refetch } = useCompanyIntents();
  const createIntent = useCreateCompanyIntent();
  const updateIntent = useUpdateCompanyIntent();
  const runIntent = useRunCompanyIntent();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<IntentFormState>(emptyForm());

  const intents = data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return intents;
    return intents.filter(({ id, intent }) =>
      [
        id,
        intent.for,
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
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((record) => record.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  const selected =
    filtered.find((record) => record.id === selectedId) ?? filtered[0] ?? null;

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
      setSelectedId(created.id);
    } else if (formMode === "edit" && selected) {
      const updated = await updateIntent.mutateAsync({
        id: selected.id,
        data: input,
      });
      setSelectedId(updated.id);
    }
    setFormMode(null);
  }

  async function setLifecycle(status: CompanyIntentStatus) {
    if (!selected) return;
    const updated = await updateIntent.mutateAsync({
      id: selected.id,
      data: { status },
    });
    setSelectedId(updated.id);
  }

  const formIdValid = !form.id || isCompanyIntentId(form.id);
  const formCanSubmit =
    formIdValid &&
    form.for.trim().length > 0 &&
    !createIntent.isPending &&
    !updateIntent.isPending;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-body-xs font-medium uppercase tracking-normal text-muted-foreground">
              <Compass className="h-4 w-4 text-cyan-500" aria-hidden="true" />
              Company manager
            </div>
            <h1 className="mt-2 text-title-lg font-semibold tracking-normal">
              Intents
            </h1>
            <p className="mt-1 max-w-3xl text-body-sm text-muted-foreground">
              Guidance the CTO uses to manage company goals, loops, and
              responsibilities.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              Refresh
            </Button>
            <Button type="button" onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New intent
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCell label="Total" value={String(intents.length)} />
          <SummaryCell label="Active" value={String(activeCount)} />
          <SummaryCell label="Warnings" value={String(warningCount)} />
        </section>

        {error ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-body-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden="true" />
            <div>
              <div className="font-medium">Failed to load intents</div>
              <div className="mt-1 text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </div>
            </div>
          </div>
        ) : null}

        <section className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search intents"
                className="pl-9"
              />
            </div>

            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-body-xs text-muted-foreground">
                <span>{filtered.length} intents</span>
                {isFetching ? <span>Updating</span> : null}
              </div>
              <div className="max-h-[640px] overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-body-sm text-muted-foreground">
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Loading intents
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-6 text-body-sm text-muted-foreground">
                    No company intents found.
                  </div>
                ) : (
                  filtered.map((record) => (
                    <IntentListItem
                      key={record.id}
                      record={record}
                      selected={record.id === selected?.id}
                      onSelect={() => setSelectedId(record.id)}
                    />
                  ))
                )}
              </div>
            </div>
          </aside>

          <section className="min-w-0 rounded-md border border-border">
            {selected ? (
              <IntentDetail
                record={selected}
                running={runIntent.isPending}
                updating={updateIntent.isPending}
                onEdit={() => openEdit(selected)}
                onRun={() => runIntent.mutate(selected.id)}
                onLifecycle={setLifecycle}
              />
            ) : (
              <EmptyDetail />
            )}
          </section>
        </section>
      </div>

      <Dialog open={formMode !== null} onOpenChange={(open) => !open && setFormMode(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? "New intent" : "Edit intent"}
            </DialogTitle>
            <DialogDescription>
              Define what the CTO should optimize for when managing this
              company portfolio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Intent ID">
                <Input
                  value={form.id}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, id: event.target.value }))
                  }
                  onBlur={() =>
                    setForm((prev) => ({
                      ...prev,
                      id: prev.id || slugifyCompanyIntentId(prev.for),
                    }))
                  }
                  disabled={formMode === "edit"}
                  placeholder="release-health"
                />
                {!formIdValid ? (
                  <p className="mt-1 text-body-xs text-destructive">
                    Use lowercase letters, numbers, and dashes. Start with a
                    letter.
                  </p>
                ) : null}
              </Field>
              <Field label="Priority">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onValueChange={(value: CompanyIntentStatus) =>
                    setForm((prev) => ({ ...prev, status: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Posture">
                <Select
                  value={form.posture}
                  onValueChange={(value: CompanyIntentPosture) =>
                    setForm((prev) => ({ ...prev, posture: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {postureOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Intent">
              <Textarea
                value={form.for}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, for: event.target.value }))
                }
                placeholder="Keep releases healthy without creating unnecessary portfolio work."
                className="min-h-24"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repos">
                <Textarea
                  value={form.repos}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, repos: event.target.value }))
                  }
                  placeholder="owner/repo, one per line"
                />
              </Field>
              <Field label="Areas">
                <Textarea
                  value={form.areas}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, areas: event.target.value }))
                  }
                  placeholder="release, QA, operations"
                />
              </Field>
              <Field label="Principles">
                <Textarea
                  value={form.principles}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      principles: event.target.value,
                    }))
                  }
                  placeholder="One per line"
                />
              </Field>
              <Field label="Metrics">
                <Textarea
                  value={form.metrics}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, metrics: event.target.value }))
                  }
                  placeholder="One per line"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField
                label="Cadence"
                value={form.releaseCadence}
                values={["manual", "1d", "1w"]}
                onChange={(releaseCadence) =>
                  setForm((prev) => ({ ...prev, releaseCadence }))
                }
              />
              <SelectField
                label="QA"
                value={form.qaDepth}
                values={["light", "standard", "strict"]}
                onChange={(qaDepth) => setForm((prev) => ({ ...prev, qaDepth }))}
              />
              <SelectField
                label="Blockers"
                value={form.blockerLevel}
                values={["low", "standard", "strict"]}
                onChange={(blockerLevel) =>
                  setForm((prev) => ({ ...prev, blockerLevel }))
                }
              />
              <SelectField
                label="Approval"
                value={form.approval}
                values={[
                  "none",
                  "before-production",
                  "before-risky-actions",
                ]}
                onChange={(approval) =>
                  setForm((prev) => ({ ...prev, approval }))
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Concurrent goals">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxConcurrentGoals}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      maxConcurrentGoals: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Daily actions">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxDailyActions}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      maxDailyActions: event.target.value,
                    }))
                  }
                />
              </Field>
              <SelectField
                label="Review"
                value={form.reviewEvery}
                values={["1d", "1w"]}
                onChange={(reviewEvery) =>
                  setForm((prev) => ({ ...prev, reviewEvery }))
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Human required for">
                <Textarea
                  value={form.requiresHumanFor}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      requiresHumanFor: event.target.value,
                    }))
                  }
                  placeholder="One per line"
                />
              </Field>
              <Field label="Portfolio seeds">
                <Textarea
                  value={[
                    sectionText("goals", form.goals),
                    sectionText("loops", form.loops),
                    sectionText("responsibilities", form.responsibilities),
                  ]
                    .filter(Boolean)
                    .join("\n\n")}
                  onChange={(event) => {
                    const parsed = parsePortfolioText(event.target.value);
                    setForm((prev) => ({ ...prev, ...parsed }));
                  }}
                  placeholder="goals: release-health&#10;loops: company-manager-loop&#10;responsibilities: company-manager"
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
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
    </main>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-card",
        selected && "bg-card",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-body-sm font-medium">{record.id}</div>
          <div className="mt-1 line-clamp-2 text-body-xs text-muted-foreground">
            {record.intent.for || "No intent target"}
          </div>
        </div>
        <StatusBadge status={record.intent.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-body-xs text-muted-foreground">
        <span>priority {record.intent.priority}</span>
        <span>{record.intent.posture}</span>
        {warnings.length ? <span>{warnings.length} warnings</span> : null}
      </div>
    </button>
  );
}

function IntentDetail({
  record,
  running,
  updating,
  onEdit,
  onRun,
  onLifecycle,
}: {
  record: CompanyIntentRecord;
  running: boolean;
  updating: boolean;
  onEdit: () => void;
  onRun: () => void;
  onLifecycle: (status: CompanyIntentStatus) => void;
}) {
  const { intent, decisions, managerHealth } = record;
  const warnings = companyIntentWarnings(intent, managerHealth);
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <StatusBadge status={intent.status} />
              <Badge variant="secondary">{intent.posture}</Badge>
              <Badge variant="outline">priority {intent.priority}</Badge>
            </div>
            <h2 className="break-words text-title-md font-semibold">
              {intent.id}
            </h2>
            <p className="mt-2 max-w-4xl break-words text-body-sm text-muted-foreground">
              {intent.for || "No intent target"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onEdit} className="gap-2">
              <Edit3 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onRun}
              disabled={running || intent.status !== "active"}
              className="gap-2"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              Review now
            </Button>
            {intent.status === "active" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onLifecycle("paused")}
                disabled={updating}
                className="gap-2"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                Pause
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => onLifecycle("active")}
                disabled={updating}
                className="gap-2"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Activate
              </Button>
            )}
            {intent.status !== "archived" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onLifecycle("archived")}
                disabled={updating}
                className="gap-2"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Archive
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 divide-y divide-border">
          {warnings.length ? (
            <Block title="Warnings" icon={AlertCircle}>
              <div className="flex flex-wrap gap-2">
                {warnings.map((warning) => (
                  <Badge key={warning} variant="outline" className="text-amber-600">
                    {warning}
                  </Badge>
                ))}
              </div>
            </Block>
          ) : null}
          <Block title="Policy" icon={ShieldCheck}>
            <PolicyGrid intent={intent} />
          </Block>
          <Block title="Principles" icon={Compass}>
            <TextList items={intent.principles} empty="No principles set." />
          </Block>
          <Block title="Metrics" icon={ShieldCheck}>
            <TextList items={intent.metrics} empty="No metrics set." />
          </Block>
          <Block title="Decision Log" icon={CalendarClock}>
            <DecisionLog decisions={decisions} />
          </Block>
        </div>

        <aside className="border-t border-border p-4 lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <ManagerHealth intent={intent} record={record} />
            <ChipGroup title="Repos" items={intent.scope.repos} />
            <ChipGroup title="Areas" items={intent.scope.areas} />
            <Portfolio intent={intent} />
          </div>
        </aside>
      </div>
    </div>
  );
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
    <div>
      <h3 className="text-body-sm font-medium">CTO loop</h3>
      <dl className="mt-2 space-y-2 text-body-xs text-muted-foreground">
        <Meta label="Agent" value={intent.manager.agent} />
        <Meta label="Review" value={intent.manager.reviewEvery} />
        <Meta
          label="Loop"
          value={health?.loop.exists ? `${health.loop.id} (${health.loop.state ?? "ready"})` : `${intent.manager.loop} missing`}
        />
        <Meta
          label="Responsibility"
          value={
            health?.responsibility.exists
              ? health.responsibility.disabled
                ? `${health.responsibility.id} disabled`
                : `${health.responsibility.id} ready`
              : `${intent.manager.responsibility} missing`
          }
        />
        <Meta
          label="Last review"
          value={formatDate(intent.manager.lastReviewedAt)}
        />
        <Meta
          label="Last tick"
          value={formatDate(health?.responsibility.lastTickAt ?? undefined)}
        />
      </dl>
    </div>
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
          items={automation.requiresHumanFor}
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
        <LinkedChipGroup title="Goals" items={intent.portfolio.goals} href="/agent-goals" />
        <LinkedChipGroup title="Loops" items={intent.portfolio.loops} href="/agent-loops" />
        <LinkedChipGroup
          title="Responsibilities"
          items={intent.portfolio.responsibilities}
          href="/agent-responsibilities"
        />
      </div>
    </div>
  );
}

function DecisionLog({
  decisions,
}: {
  decisions: CompanyIntentDecisionLog[];
}) {
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
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Compass;
  children: React.ReactNode;
}) {
  return (
    <section className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-body-sm font-medium">
        <Icon className="h-4 w-4 text-cyan-500" aria-hidden="true" />
        {title}
      </h3>
      {children}
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

function SelectField<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next: T) => onChange(next)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-body-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-title-sm font-semibold">{value}</div>
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
            <a key={item} href={href} className="max-w-full">
              <Badge
                variant="outline"
                className="max-w-full break-all font-normal hover:bg-card"
              >
                {item}
              </Badge>
            </a>
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
        "shrink-0 capitalize",
        status === "active" && "border-emerald-500/40 text-emerald-600",
        status === "paused" && "border-amber-500/40 text-amber-600",
        status === "archived" && "border-muted-foreground/30",
      )}
    >
      {status}
    </Badge>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt>{label}</dt>
      <dd className="min-w-0 break-all text-right text-foreground">{value}</dd>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-6 text-center text-body-sm text-muted-foreground">
      Select an intent to inspect its CTO guidance.
    </div>
  );
}

function emptyForm(): IntentFormState {
  return {
    id: "",
    for: "",
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
    loops: "company-manager-loop",
    responsibilities: "company-manager",
    reviewEvery: "1d",
  };
}

function recordToForm(record: CompanyIntentRecord): IntentFormState {
  const intent = record.intent;
  return {
    id: intent.id,
    for: intent.for,
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
    responsibilities: intent.portfolio.responsibilities.join("\n"),
    reviewEvery: intent.manager.reviewEvery,
  };
}

function formToInput(form: IntentFormState): CompanyIntentInput {
  return {
    id: form.id || slugifyCompanyIntentId(form.for),
    for: form.for.trim(),
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
      responsibilities: parseLines(form.responsibilities).filter(
        isCompanyIntentId,
      ),
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

function sectionText(label: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${label}: ${trimmed}` : "";
}

function parsePortfolioText(value: string): Pick<
  IntentFormState,
  "goals" | "loops" | "responsibilities"
> {
  const result = { goals: "", loops: "", responsibilities: "" };
  let current: keyof typeof result | null = null;
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^(goals|loops|responsibilities):\s*(.*)$/i);
    if (match) {
      current = match[1].toLowerCase() as keyof typeof result;
      result[current] = match[2]?.trim() ?? "";
      continue;
    }
    if (current && line.trim()) {
      result[current] = [result[current], line.trim()].filter(Boolean).join("\n");
    }
  }
  return result;
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
