/**
 * @fileType component
 * @domain kody
 * @pattern managed-models
 * @ai-summary Shared AgentGoal/AgentLoop page backed by engine state files.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  Loader2,
  Package,
  Pause,
  Pencil,
  Play,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Route,
  ShieldAlert,
  Target,
  Trash2,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Checkbox } from "@dashboard/ui/checkbox";
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

import {
  useCapabilities,
  useRunCapability,
  type CapabilitySummary,
} from "../hooks/useCapabilities";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  useCreateManagedGoal,
  useDeleteManagedGoal,
  useManagedGoals,
  useRunManagedGoal,
  useSetManagedGoalState,
  useUpdateManagedGoal,
} from "../hooks/useManagedGoals";
import { useWorkflowDefinitions } from "../hooks/useWorkflowDefinitions";
import {
  MANAGED_GOAL_TYPES,
  buildSimpleManagedGoalCreateInput,
  canDeleteManagedGoal,
  isStoreBackedManagedGoal,
  managedGoalModel,
  normalizeEvidenceKey,
  type ManagedGoalInstanceSummary,
  type ManagedGoalPreferredRunTime,
  type ManagedLoopTarget,
  type ManagedGoalModel,
  type ManagedGoalRecord,
  type ManagedGoalRouteStep,
  type ManagedGoalSchedule,
  type ManagedGoalTypeDefinition,
  type ManagedGoalTypeId,
} from "../managed-goals";
import type { WorkflowDefinitionRecord } from "../workflow-definitions";
import { scheduleEveryLabel, type ScheduleEvery } from "../ticked/frontmatter";
import { selectionPath } from "../selection-routing";
import { cn } from "../utils";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import {
  SearchableSelect,
  SearchableMultiSelect,
  type SearchableSelectOption,
} from "./SearchableSelect";

const defaultGoalType = MANAGED_GOAL_TYPES[0]!;
const USER_VISIBLE_OBJECTIVE_TYPE_IDS = new Set<ManagedGoalTypeId>(["improve"]);

function userVisibleObjectiveGoalTypes(): ManagedGoalTypeDefinition[] {
  return MANAGED_GOAL_TYPES.filter(
    (type) =>
      type.model === "agentGoal" &&
      USER_VISIBLE_OBJECTIVE_TYPE_IDS.has(type.id),
  );
}

type ManagedModelViewCopy = {
  title: string;
  singular: string;
  plural: string;
  kindLabel: string;
  selectTitle: string;
  selectHint: string;
  emptyTitle: string;
  emptyHint: string;
  searchPlaceholder: string;
  newLabel: string;
};

const viewCopy: Record<ManagedGoalModel, ManagedModelViewCopy> = {
  agentGoal: {
    title: "Goals",
    singular: "goal",
    plural: "goals",
    kindLabel: "",
    selectTitle: "Select a goal",
    selectHint: "Choose a goal from the list.",
    emptyTitle: "No goals yet",
    emptyHint: "Create the first evidence-driven goal for this repo.",
    searchPlaceholder: "Search goals...",
    newLabel: "New goal",
  },
  agentLoop: {
    title: "Loops",
    singular: "loop",
    plural: "loops",
    kindLabel: "Loop type",
    selectTitle: "Select loop",
    selectHint: "Choose loop from the list.",
    emptyTitle: "No loops yet",
    emptyHint: "Create the first schedule or health driven loop for this repo.",
    searchPlaceholder: "Search loops...",
    newLabel: "New loop",
  },
};

const scheduleOptions = [
  { value: "manual", label: "Manual" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "1d", label: "Every day" },
  { value: "7d", label: "Every week" },
  { value: "30d", label: "Every month" },
] satisfies { value: ManagedGoalSchedule; label: string }[];

const preferredRunTimeOptions = Array.from({ length: 24 }, (_, hour) => {
  const time = `${String(hour).padStart(2, "0")}:00`;
  return { value: time, label: time };
});

const commonTimeZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Jerusalem",
  "Asia/Tokyo",
];

function scheduleLabel(schedule: unknown): string {
  return (
    scheduleOptions.find((option) => option.value === schedule)?.label ??
    "Manual"
  );
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function buildPreferredRunTime(
  time: string,
  timezone: string,
): ManagedGoalPreferredRunTime | undefined {
  const trimmedTime = time.trim();
  const trimmedTimezone = timezone.trim();
  if (!trimmedTime || !trimmedTimezone) return undefined;
  return { time: trimmedTime, timezone: trimmedTimezone };
}

function preferredRunTimeZoneOptions(timezone: string): string[] {
  const current = timezone.trim() || "UTC";
  return [current, ...commonTimeZones.filter((option) => option !== current)];
}

function preferredRunTimeLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const runTime = value as Partial<ManagedGoalPreferredRunTime>;
  if (typeof runTime.time !== "string" || !runTime.time.trim()) return null;
  if (typeof runTime.timezone !== "string" || !runTime.timezone.trim()) {
    return runTime.time.trim();
  }
  return `${runTime.time.trim()} ${runTime.timezone.trim()}`;
}

function scheduleSummary(goal: ManagedGoalRecord): string {
  const preferred = preferredRunTimeLabel(goal.state.preferredRunTime);
  return preferred
    ? `${scheduleLabel(goal.state.schedule)} at ${preferred}`
    : scheduleLabel(goal.state.schedule);
}

function PreferredRunTimeFields({
  idPrefix,
  time,
  timezone,
  timezoneChoices,
  onTimeChange,
  onTimezoneChange,
}: {
  idPrefix: string;
  time: string;
  timezone: string;
  timezoneChoices: string[];
  onTimeChange: (time: string) => void;
  onTimezoneChange: (timezone: string) => void;
}) {
  const timezoneValue = timezone.trim() || "UTC";

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-preferred-run-at`}>Preferred time</Label>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <Select
          value={time || "none"}
          onValueChange={(value) => onTimeChange(value === "none" ? "" : value)}
        >
          <SelectTrigger
            id={`${idPrefix}-preferred-run-at`}
            className="min-w-0"
          >
            {time ? (
              <span className="font-mono">{time}</span>
            ) : (
              <span>Any time</span>
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Any time</SelectItem>
            {preferredRunTimeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="font-mono">{option.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timezoneValue} onValueChange={onTimezoneChange}>
          <SelectTrigger
            id={`${idPrefix}-preferred-run-timezone`}
            aria-label="Preferred timezone"
            className="min-w-0 font-mono text-xs"
          >
            <span className="truncate">{timezoneValue}</span>
          </SelectTrigger>
          <SelectContent
            align="end"
            className="max-w-[min(20rem,calc(100vw-2rem))]"
          >
            {timezoneChoices.map((option) => (
              <SelectItem key={option} value={option}>
                <span className="font-mono text-xs">{option}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function modelTypeLabel(goal: ManagedGoalRecord): string {
  return (
    MANAGED_GOAL_TYPES.find((type) => type.id === goal.state.type)?.label ??
    goal.state.type
  );
}

function goalFactEntries(goal: ManagedGoalRecord): Array<[string, unknown]> {
  return Object.entries(goal.state.facts).filter(([key]) => key !== "goalType");
}

function completedEvidence(goal: ManagedGoalRecord): number {
  return goal.state.destination.evidence.filter(
    (key) => goal.state.facts[key] === true,
  ).length;
}

function nextEvidence(goal: ManagedGoalRecord): string | null {
  return (
    goal.state.destination.evidence.find(
      (key) => goal.state.facts[key] !== true,
    ) ?? null
  );
}

function currentRouteStep(goal: ManagedGoalRecord) {
  const next = nextEvidence(goal);
  return next ? goal.state.route.find((step) => step.evidence === next) : null;
}

function instanceSummaries(
  goal: ManagedGoalRecord,
): ManagedGoalInstanceSummary[] {
  if (Array.isArray(goal.state.instances)) {
    return goal.state.instances.filter(
      (instance): instance is ManagedGoalInstanceSummary =>
        !!instance &&
        typeof instance === "object" &&
        typeof instance.id === "string" &&
        typeof instance.state === "string" &&
        !!instance.facts &&
        typeof instance.facts === "object" &&
        !Array.isArray(instance.facts) &&
        Array.isArray(instance.blockers),
    );
  }

  const ids = Array.isArray(goal.state.instanceIds)
    ? goal.state.instanceIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];

  return ids.map((id) => ({
    id,
    state: "active",
    facts: {},
    blockers: [],
  }));
}

function completedInstanceEvidence(
  goal: ManagedGoalRecord,
  instance: ManagedGoalInstanceSummary,
): number {
  return goal.state.destination.evidence.filter(
    (evidence) => instance.facts[evidence] === true,
  ).length;
}

function goalActivityTone(state: string) {
  if (state === "active") {
    return {
      label: "Active",
      rowClass:
        "border-l-2 border-l-sky-400 bg-sky-500/[0.06] hover:bg-sky-500/[0.09]",
      selectedClass: "bg-sky-500/[0.12]",
      iconClass: "text-sky-300",
      badgeClass: "border-sky-400/30 bg-sky-400/10 text-sky-200",
      headerClass:
        "border-sky-400/20 bg-gradient-to-b from-sky-500/[0.12] via-sky-500/[0.04] to-transparent",
      outcomeClass: "border-sky-400/15 bg-sky-400/[0.04]",
    };
  }
  if (state === "paused") {
    return {
      label: "Paused",
      rowClass:
        "border-l-2 border-l-amber-400/60 bg-amber-500/[0.045] hover:bg-amber-500/[0.07]",
      selectedClass: "bg-amber-500/[0.1]",
      iconClass: "text-amber-300",
      badgeClass: "border-amber-400/25 bg-amber-400/10 text-amber-200",
      headerClass:
        "border-amber-400/18 bg-gradient-to-b from-amber-500/[0.1] via-amber-500/[0.035] to-transparent",
      outcomeClass: "border-amber-400/15 bg-amber-400/[0.035]",
    };
  }
  if (state === "done") {
    return {
      label: "Done",
      rowClass:
        "border-l-2 border-l-emerald-400/60 bg-emerald-500/[0.045] hover:bg-emerald-500/[0.07]",
      selectedClass: "bg-emerald-500/[0.1]",
      iconClass: "text-emerald-300",
      badgeClass: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
      headerClass:
        "border-emerald-400/18 bg-gradient-to-b from-emerald-500/[0.1] via-emerald-500/[0.035] to-transparent",
      outcomeClass: "border-emerald-400/15 bg-emerald-400/[0.035]",
    };
  }
  return {
    label: "Inactive",
    rowClass:
      "border-l-2 border-l-white/10 bg-white/[0.012] opacity-70 hover:bg-white/[0.035] hover:opacity-90",
    selectedClass: "bg-white/[0.06] opacity-100",
    iconClass: "text-white/35",
    badgeClass: "border-white/10 bg-white/[0.035] text-white/45",
    headerClass:
      "border-white/[0.06] bg-gradient-to-b from-white/[0.035] via-white/[0.012] to-transparent",
    outcomeClass: "border-white/[0.06] bg-white/[0.015]",
  };
}

function GoalActivityBadge({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  const tone = goalActivityTone(state);
  const Icon =
    state === "active"
      ? Power
      : state === "paused"
        ? Pause
        : state === "done"
          ? CheckCircle2
          : PowerOff;

  return (
    <span
      className={cn(
        "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded border",
        tone.badgeClass,
        className,
      )}
      title={tone.label}
      aria-label={tone.label}
      role="img"
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function StoreModelBadge({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
        className,
      )}
      title={`Store ${label}`}
      aria-label={`Store ${label}`}
      role="img"
    >
      <Package className="h-3.5 w-3.5" />
    </span>
  );
}

function goalSearchText(goal: ManagedGoalRecord): string {
  const loopTarget = managedLoopTarget(goal);
  return [
    goal.id,
    goal.source ?? "",
    goal.recordType ?? "",
    goal.state.type,
    scheduleSummary(goal),
    goal.state.state,
    goal.state.stage ?? "",
    loopTarget?.type ?? "",
    loopTarget?.id ?? "",
    goal.state.destination.outcome,
    ...goal.state.destination.evidence,
    ...goal.state.capabilities,
    ...goal.state.route.flatMap((step) => [
      step.stage,
      step.evidence,
      step.capability,
    ]),
    ...goal.state.blockers,
  ]
    .join(" ")
    .toLowerCase();
}

function compactCapabilityLabel(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capabilitySelectOptions(
  capabilities: CapabilitySummary[],
  seedSlugs: string[],
): SearchableSelectOption[] {
  const bySlug = new Map<string, SearchableSelectOption>();
  for (const slug of seedSlugs) {
    bySlug.set(slug, {
      value: slug,
      label: slug,
      selectedLabel: compactCapabilityLabel(slug),
      searchText: slug,
    });
  }
  for (const capability of capabilities) {
    const label = capability.describe || capability.slug;
    const source = capability.source ? ` / ${capability.source}` : "";
    bySlug.set(capability.slug, {
      value: capability.slug,
      label,
      selectedLabel: compactCapabilityLabel(capability.slug),
      description: `${capability.slug}${source}`,
      searchText: `${label} ${capability.slug} ${capability.source ?? ""}`,
    });
  }
  return Array.from(bySlug.values()).sort((a, b) =>
    (a.value ?? "").localeCompare(b.value ?? ""),
  );
}

function goalTargetOptions(
  goals: ManagedGoalRecord[],
): SearchableSelectOption[] {
  return goals
    .filter((goal) => managedGoalModel(goal) === "agentGoal")
    .map((goal) => ({
      value: goal.id,
      label: goal.id,
      selectedLabel: goal.id,
      description: goal.state.destination.outcome,
      searchText: `${goal.id} ${goal.state.type} ${goal.state.destination.outcome}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function workflowTargetOptions(
  workflows: WorkflowDefinitionRecord[],
): SearchableSelectOption[] {
  return workflows
    .map((workflow) => ({
      value: workflow.id,
      label: workflow.workflow.name || workflow.id,
      selectedLabel: workflow.id,
      description: `${workflow.id}${workflow.source ? ` / ${workflow.source}` : ""}`,
      searchText: [
        workflow.id,
        workflow.workflow.name,
        workflow.workflow.instructions,
        workflow.source ?? "",
        ...workflow.workflow.capabilities,
      ].join(" "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function isManagedLoopTarget(value: unknown): value is ManagedLoopTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Partial<ManagedLoopTarget>;
  return (
    (target.type === "goal" ||
      target.type === "capability" ||
      target.type === "workflow") &&
    typeof target.id === "string" &&
    target.id.trim().length > 0
  );
}

function managedLoopTarget(goal: ManagedGoalRecord): ManagedLoopTarget | null {
  if (isManagedLoopTarget(goal.state.loopTarget)) {
    return {
      type: goal.state.loopTarget.type,
      id: goal.state.loopTarget.id.trim(),
    };
  }
  if (managedGoalModel(goal) !== "agentLoop") return null;
  const firstCapability = goal.state.capabilities[0]?.trim();
  return firstCapability ? { type: "capability", id: firstCapability } : null;
}

function loopTargetLabel(target: ManagedLoopTarget | null): string {
  if (!target) return "No target";
  if (target.type === "goal") return `Goal: ${target.id}`;
  if (target.type === "workflow") return `Workflow: ${target.id}`;
  return `Capability: ${target.id}`;
}

function mergeOrderedSlugs(current: string[], next: string[]): string[] {
  const nextSet = new Set(next);
  return [
    ...current.filter((slug) => nextSet.has(slug)),
    ...next.filter((slug) => !current.includes(slug)),
  ];
}

function moveItem<T>(
  items: readonly T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function fallbackRouteStep(slug: string): ManagedGoalRouteStep {
  return {
    stage: slug,
    evidence: normalizeEvidenceKey(`${slug}Complete`) || `${slug}Complete`,
    capability: slug,
  };
}

function routeStepsForCapabilities(
  goalType: ManagedGoalTypeDefinition,
  slugs: string[],
  existingRoute: ManagedGoalRouteStep[] = [],
): ManagedGoalRouteStep[] {
  const existingByCapability = new Map(
    existingRoute.map((step) => [step.capability, step]),
  );
  const defaultsByCapability = new Map(
    goalType.route.map((step) => [step.capability, step]),
  );

  return slugs.map((slug) => ({
    ...(existingByCapability.get(slug) ??
      defaultsByCapability.get(slug) ??
      fallbackRouteStep(slug)),
  }));
}

function routeStepsWithReportPreference(
  route: ManagedGoalRouteStep[],
  saveReport: boolean,
): ManagedGoalRouteStep[] {
  return route.map((step) => {
    const next = { ...step };
    if (saveReport) {
      next.saveReport = true;
    } else {
      delete next.saveReport;
    }
    return next;
  });
}

function routeSavesReport(route: ManagedGoalRouteStep[]): boolean {
  return route.length > 0 && route.every((step) => step.saveReport === true);
}

function evidenceForRoute(route: ManagedGoalRouteStep[]): string[] {
  return Array.from(new Set(route.map((step) => step.evidence)));
}

function SaveReportCheckbox({
  id,
  checked,
  onCheckedChange,
  description,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="text-sm text-white/90">
          Save output as report
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function OrderedPathSection({
  title,
  hint,
  route,
  capabilitySlugs,
  onMove,
}: {
  title: string;
  hint: string;
  route?: ManagedGoalRouteStep[];
  capabilitySlugs: string[];
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const rows = route ?? capabilitySlugs.map(fallbackRouteStep);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-white/[0.08] bg-black/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-white/90">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="font-mono text-xs text-white/45">{rows.length}</span>
      </div>
      <div className="space-y-2">
        {rows.map((step, index) => (
          <div
            key={`${step.capability}:${step.evidence}:${index}`}
            className="grid gap-3 rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2 text-white/80">
                <Route className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="font-mono text-xs text-white/45">
                  {index + 1}
                </span>
                <span className="truncate">{step.stage}</span>
                {route ? (
                  <>
                    <span className="text-white/30">{"->"}</span>
                    <span className="truncate font-mono">{step.evidence}</span>
                  </>
                ) : null}
              </div>
              <p className="truncate text-xs text-white/45">
                capability: {step.capability}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={() => onMove(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${step.capability} up`}
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={() => onMove(index, 1)}
                disabled={index === rows.length - 1}
                aria-label={`Move ${step.capability} down`}
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NewGoalDialog({
  open,
  onOpenChange,
  model,
  label,
  goals,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ManagedGoalModel;
  label: string;
  goals: ManagedGoalRecord[];
  onCreated?: (goal: ManagedGoalRecord) => void;
}) {
  const createGoal = useCreateManagedGoal();
  const { data: capabilities = [], isLoading: capabilitiesLoading } =
    useCapabilities();
  const goalTypes = useMemo(
    () =>
      model === "agentGoal"
        ? userVisibleObjectiveGoalTypes()
        : MANAGED_GOAL_TYPES.filter((type) => type.model === model),
    [model],
  );
  const defaultType = goalTypes[0] ?? defaultGoalType;
  const isRoutine = model === "agentLoop";
  const defaultSchedule: ManagedGoalSchedule = isRoutine ? "1d" : "manual";
  const defaultTimeZone = useMemo(() => browserTimeZone(), []);
  const [goalType, setGoalType] = useState<ManagedGoalTypeId>(defaultType.id);
  const [schedule, setSchedule] =
    useState<ManagedGoalSchedule>(defaultSchedule);
  const [preferredRunAt, setPreferredRunAt] = useState("");
  const [preferredRunTimeZone, setPreferredRunTimeZone] =
    useState(defaultTimeZone);
  const preferredRunTimeZoneChoices = useMemo(
    () => preferredRunTimeZoneOptions(preferredRunTimeZone),
    [preferredRunTimeZone],
  );
  const [outcome, setOutcome] = useState("");
  const [loopTargetType, setLoopTargetType] =
    useState<ManagedLoopTarget["type"]>("goal");
  const [selectedLoopGoalId, setSelectedLoopGoalId] = useState<string | null>(
    null,
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [selectedCapabilitySlugs, setSelectedCapabilitySlugs] = useState<
    string[]
  >([]);
  const [saveReport, setSaveReport] = useState(isRoutine);

  const selectedGoalType =
    goalTypes.find((type) => type.id === goalType) ?? defaultType;
  const scheduleChoices = isRoutine
    ? scheduleOptions.filter((option) => option.value !== "manual")
    : scheduleOptions;
  const loopGoalOptions = useMemo(() => goalTargetOptions(goals), [goals]);
  const { data: workflows = [], isLoading: workflowsLoading } =
    useWorkflowDefinitions();
  const workflowOptions = useMemo(
    () => workflowTargetOptions(workflows),
    [workflows],
  );
  const capabilityOptions = useMemo(
    () => capabilitySelectOptions(capabilities, selectedGoalType.capabilities),
    [capabilities, selectedGoalType.capabilities],
  );
  const routeSteps = useMemo(
    () =>
      isRoutine
        ? []
        : routeStepsForCapabilities(selectedGoalType, selectedCapabilitySlugs),
    [isRoutine, selectedCapabilitySlugs, selectedGoalType],
  );
  const selectedLoopCapabilitySlug = selectedCapabilitySlugs[0] ?? null;
  const preferredRunTime = buildPreferredRunTime(
    preferredRunAt,
    preferredRunTimeZone,
  );
  const loopTarget: ManagedLoopTarget | undefined = isRoutine
    ? loopTargetType === "goal"
      ? selectedLoopGoalId
        ? { type: "goal", id: selectedLoopGoalId }
        : undefined
      : loopTargetType === "workflow"
        ? selectedWorkflowId
          ? { type: "workflow", id: selectedWorkflowId }
          : undefined
        : selectedLoopCapabilitySlug
          ? {
              type: "capability",
              id: selectedLoopCapabilitySlug,
            }
          : undefined
    : undefined;
  const canSubmit =
    outcome.trim().length > 0 &&
    (isRoutine ? !!loopTarget : selectedCapabilitySlugs.length > 0) &&
    (!isRoutine ||
      !preferredRunAt.trim() ||
      preferredRunTimeZone.trim().length > 0);
  const intentLabel = isRoutine ? "Scope" : "Finish line";
  const dialogDescription = isRoutine
    ? "Create one ongoing loop with a clear scope, cadence, and capabilities."
    : "Define the finish line and attach the capabilities Kody should use.";
  const intentPlaceholder = isRoutine
    ? "Example: Keep codebase healthy and surface drift."
    : selectedGoalType.promptPlaceholder;

  useEffect(() => {
    if (!goalTypes.some((type) => type.id === goalType)) {
      setGoalType(defaultType.id);
    }
  }, [defaultType.id, goalType, goalTypes]);

  useEffect(() => {
    if (isRoutine && schedule === "manual") {
      setSchedule(defaultSchedule);
    }
    if (!isRoutine && schedule !== "manual") {
      setSchedule("manual");
    }
  }, [defaultSchedule, isRoutine, schedule]);

  useEffect(() => {
    if (!isRoutine || loopTargetType !== "goal") return;
    if (
      selectedLoopGoalId &&
      loopGoalOptions.some((option) => option.value === selectedLoopGoalId)
    ) {
      return;
    }
    setSelectedLoopGoalId(loopGoalOptions[0]?.value ?? null);
  }, [isRoutine, loopGoalOptions, loopTargetType, selectedLoopGoalId]);

  const reset = useCallback(() => {
    setGoalType(defaultType.id);
    setSchedule(defaultSchedule);
    setPreferredRunAt("");
    setPreferredRunTimeZone(defaultTimeZone);
    setOutcome("");
    setLoopTargetType("goal");
    setSelectedLoopGoalId(null);
    setSelectedWorkflowId(null);
    setSelectedCapabilitySlugs([]);
    setSaveReport(isRoutine);
  }, [defaultSchedule, defaultTimeZone, defaultType.id, isRoutine]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const selectCapabilities = (next: string[]) => {
    setSelectedCapabilitySlugs((current) => mergeOrderedSlugs(current, next));
  };

  const moveSelectedCapability = (index: number, direction: -1 | 1) => {
    setSelectedCapabilitySlugs((current) =>
      moveItem(current, index, direction),
    );
  };

  const updatePreferredRunAt = (value: string) => {
    setPreferredRunAt(value === "none" ? "" : value);
  };

  const submit = async () => {
    const routeWithReportPreference = routeStepsWithReportPreference(
      routeSteps,
      saveReport,
    );
    const created = await createGoal.mutateAsync(
      buildSimpleManagedGoalCreateInput({
        goalType,
        schedule,
        preferredRunTime: isRoutine ? preferredRunTime : undefined,
        prompt: outcome,
        loopTarget,
        saveReport: isRoutine ? saveReport : undefined,
        capabilities: isRoutine
          ? loopTarget?.type === "capability"
            ? [loopTarget.id]
            : []
          : selectedCapabilitySlugs,
        evidence: isRoutine ? [] : evidenceForRoute(routeSteps),
        route: isRoutine ? [] : routeWithReportPreference,
      }),
    );
    reset();
    onOpenChange(false);
    onCreated?.(created);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden sm:w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New {label}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-outcome">{intentLabel}</Label>
            <Textarea
              id="goal-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder={intentPlaceholder}
              rows={4}
            />
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {isRoutine ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="goal-schedule">Cadence</Label>
                  <Select
                    value={schedule}
                    onValueChange={(value) =>
                      setSchedule(value as ManagedGoalSchedule)
                    }
                  >
                    <SelectTrigger id="goal-schedule">
                      <SelectValue placeholder="Choose cadence" />
                    </SelectTrigger>
                    <SelectContent>
                      {scheduleChoices.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <PreferredRunTimeFields
                  idPrefix="loop"
                  time={preferredRunAt}
                  timezone={preferredRunTimeZone}
                  timezoneChoices={preferredRunTimeZoneChoices}
                  onTimeChange={updatePreferredRunAt}
                  onTimezoneChange={setPreferredRunTimeZone}
                />
                <div className="space-y-2">
                  <Label htmlFor="loop-target-type">Target type</Label>
                  <Select
                    value={loopTargetType}
                    onValueChange={(value) => {
                      setLoopTargetType(value as ManagedLoopTarget["type"]);
                      setSelectedLoopGoalId(null);
                      setSelectedWorkflowId(null);
                      setSelectedCapabilitySlugs([]);
                    }}
                  >
                    <SelectTrigger id="loop-target-type">
                      <SelectValue placeholder="Choose target type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="goal">Goal</SelectItem>
                      <SelectItem value="workflow">Workflow</SelectItem>
                      <SelectItem value="capability">Capability</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="loop-target">Target</Label>
                  {loopTargetType === "goal" ? (
                    <SearchableSelect
                      id="loop-target"
                      options={loopGoalOptions}
                      value={selectedLoopGoalId}
                      onChange={setSelectedLoopGoalId}
                      placeholder="Select goal"
                      searchPlaceholder="Search goals..."
                      emptyLabel="No goals found"
                    />
                  ) : loopTargetType === "workflow" ? (
                    <SearchableSelect
                      id="loop-target"
                      options={workflowOptions}
                      value={selectedWorkflowId}
                      onChange={setSelectedWorkflowId}
                      placeholder={
                        workflowsLoading
                          ? "Loading workflows..."
                          : "Select workflow"
                      }
                      searchPlaceholder="Search workflows..."
                      emptyLabel="No workflows found"
                      disabled={workflowsLoading}
                    />
                  ) : (
                    <SearchableSelect
                      id="loop-target"
                      options={capabilityOptions}
                      value={selectedLoopCapabilitySlug}
                      onChange={(next) =>
                        setSelectedCapabilitySlugs(next ? [next] : [])
                      }
                      placeholder={
                        capabilitiesLoading
                          ? "Loading capabilities..."
                          : "Select capability"
                      }
                      searchPlaceholder="Search capabilities..."
                      emptyLabel="No capabilities found"
                      disabled={capabilitiesLoading}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="min-w-0 space-y-2 md:col-span-2">
                <Label htmlFor="agentGoal-capabilities">Capabilities</Label>
                <SearchableMultiSelect
                  id="agentGoal-capabilities"
                  options={capabilityOptions}
                  value={selectedCapabilitySlugs}
                  onChange={selectCapabilities}
                  placeholder={
                    capabilitiesLoading
                      ? "Loading capabilities..."
                      : "Select capabilities"
                  }
                  searchPlaceholder="Search capabilities..."
                  emptyLabel="No capabilities found"
                  disabled={capabilitiesLoading}
                  selectedLabel="capabilities selected"
                  selectedSingularLabel="capability selected"
                  selectedHeading="Selected capabilities"
                  selectedTone="info"
                  maxVisibleSelected={4}
                />
                <OrderedPathSection
                  title="Route"
                  hint="The ordered path Kody follows to collect evidence."
                  route={routeSteps}
                  capabilitySlugs={selectedCapabilitySlugs}
                  onMove={moveSelectedCapability}
                />
              </div>
            )}
          </div>

          <SaveReportCheckbox
            id={isRoutine ? "loop-save-report" : "agentGoal-save-report"}
            checked={saveReport}
            onCheckedChange={setSaveReport}
            description={
              isRoutine
                ? "Writes each loop run under reports/<capability>/runs/."
                : "Writes each route capability output under reports/<capability>/runs/."
            }
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || createGoal.isPending}
            >
              {createGoal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {`Create ${label}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditManagedGoalDialog({
  goal,
  open,
  onOpenChange,
  label,
  capabilities,
  goals,
}: {
  goal: ManagedGoalRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  capabilities: CapabilitySummary[];
  goals: ManagedGoalRecord[];
}) {
  const updateGoal = useUpdateManagedGoal(goal?.id ?? "");
  const isRoutine = goal ? managedGoalModel(goal) === "agentLoop" : false;
  const objectiveGoalTypes = useMemo(() => userVisibleObjectiveGoalTypes(), []);
  const selectedGoalType = goal
    ? MANAGED_GOAL_TYPES.find((type) => type.id === goal.state.type)
    : null;
  const selectedVisibleObjectiveGoalType = selectedGoalType
    ? objectiveGoalTypes.find((type) => type.id === selectedGoalType.id)
    : null;
  const initialObjectiveGoalType =
    selectedVisibleObjectiveGoalType ??
    objectiveGoalTypes[0] ??
    defaultGoalType;
  const intentLabel = isRoutine ? "Scope" : "Finish line";
  const editDescription = isRoutine
    ? "Update agentLoop scope, cadence, and target."
    : "Update the finish line and attached capabilities.";
  const defaultTimeZone = useMemo(() => browserTimeZone(), []);
  const [outcome, setOutcome] = useState("");
  const [schedule, setSchedule] = useState<ManagedGoalSchedule>("manual");
  const [preferredRunAt, setPreferredRunAt] = useState("");
  const [preferredRunTimeZone, setPreferredRunTimeZone] =
    useState(defaultTimeZone);
  const preferredRunTimeZoneChoices = useMemo(
    () => preferredRunTimeZoneOptions(preferredRunTimeZone),
    [preferredRunTimeZone],
  );
  const [loopTargetType, setLoopTargetType] =
    useState<ManagedLoopTarget["type"]>("goal");
  const [selectedLoopGoalId, setSelectedLoopGoalId] = useState<string | null>(
    null,
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [selectedCapabilitySlugs, setSelectedCapabilitySlugs] = useState<
    string[]
  >([]);
  const [saveReport, setSaveReport] = useState(false);
  const objectiveGoalType = initialObjectiveGoalType;
  const scheduleChoices = isRoutine
    ? scheduleOptions.filter((option) => option.value !== "manual")
    : scheduleOptions;
  const loopGoalOptions = useMemo(() => goalTargetOptions(goals), [goals]);
  const { data: workflows = [], isLoading: workflowsLoading } =
    useWorkflowDefinitions();
  const workflowOptions = useMemo(
    () => workflowTargetOptions(workflows),
    [workflows],
  );
  const capabilityOptions = useMemo(
    () => capabilitySelectOptions(capabilities, goal?.state.capabilities ?? []),
    [capabilities, goal?.state.capabilities],
  );
  const routeSteps = useMemo(
    () =>
      !goal || isRoutine
        ? []
        : routeStepsForCapabilities(
            objectiveGoalType,
            selectedCapabilitySlugs,
            goal.state.route,
          ),
    [goal, isRoutine, objectiveGoalType, selectedCapabilitySlugs],
  );
  const selectedLoopCapabilitySlug = selectedCapabilitySlugs[0] ?? null;
  const preferredRunTime = buildPreferredRunTime(
    preferredRunAt,
    preferredRunTimeZone,
  );
  const loopTarget: ManagedLoopTarget | undefined = isRoutine
    ? loopTargetType === "goal"
      ? selectedLoopGoalId
        ? { type: "goal", id: selectedLoopGoalId }
        : undefined
      : loopTargetType === "workflow"
        ? selectedWorkflowId
          ? { type: "workflow", id: selectedWorkflowId }
          : undefined
        : selectedLoopCapabilitySlug
          ? {
              type: "capability",
              id: selectedLoopCapabilitySlug,
            }
          : undefined
    : undefined;

  useEffect(() => {
    if (!goal || !open) return;
    const currentSchedule = scheduleOptions.some(
      (option) => option.value === goal.state.schedule,
    )
      ? (goal.state.schedule as ManagedGoalSchedule)
      : "manual";
    setOutcome(goal.state.destination.outcome);
    setSchedule(
      isRoutine && currentSchedule === "manual" ? "1d" : currentSchedule,
    );
    if (isRoutine) {
      const target = managedLoopTarget(goal);
      const nextType = target?.type ?? "goal";
      const preferred = goal.state.preferredRunTime;
      setPreferredRunAt(
        typeof preferred?.time === "string" ? preferred.time : "",
      );
      setPreferredRunTimeZone(
        typeof preferred?.timezone === "string"
          ? preferred.timezone
          : defaultTimeZone,
      );
      setSaveReport(goal.state.saveReport !== false);
      setLoopTargetType(nextType);
      setSelectedLoopGoalId(target?.type === "goal" ? target.id : null);
      setSelectedWorkflowId(target?.type === "workflow" ? target.id : null);
      setSelectedCapabilitySlugs(
        target?.type === "capability" ? [target.id] : [],
      );
      return;
    }
    setPreferredRunAt("");
    setPreferredRunTimeZone(defaultTimeZone);
    setSaveReport(routeSavesReport(goal.state.route));
    setSelectedLoopGoalId(null);
    setSelectedWorkflowId(null);
    setSelectedCapabilitySlugs(goal.state.capabilities);
  }, [defaultTimeZone, goal, isRoutine, open]);

  const selectCapabilities = (next: string[]) => {
    setSelectedCapabilitySlugs((current) => mergeOrderedSlugs(current, next));
  };

  const moveSelectedCapability = (index: number, direction: -1 | 1) => {
    setSelectedCapabilitySlugs((current) =>
      moveItem(current, index, direction),
    );
  };

  const updatePreferredRunAt = (value: string) => {
    setPreferredRunAt(value === "none" ? "" : value);
  };

  const canSubmit =
    !!goal &&
    outcome.trim().length > 0 &&
    (isRoutine ? !!loopTarget : selectedCapabilitySlugs.length > 0) &&
    (!isRoutine ||
      !preferredRunAt.trim() ||
      preferredRunTimeZone.trim().length > 0);

  const submit = async () => {
    if (!goal) return;
    const routeWithReportPreference = routeStepsWithReportPreference(
      routeSteps,
      saveReport,
    );
    await updateGoal.mutateAsync({
      type: isRoutine ? goal.state.type : objectiveGoalType.id,
      outcome: outcome.trim(),
      schedule,
      ...(isRoutine
        ? {
            loopTarget,
            preferredRunTime: preferredRunTime ?? null,
            saveReport,
            capabilities:
              loopTarget?.type === "capability" ? [loopTarget.id] : [],
          }
        : {
            capabilities: selectedCapabilitySlugs,
            evidence: evidenceForRoute(routeSteps),
            route: routeWithReportPreference,
          }),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden sm:w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {label}</DialogTitle>
          <DialogDescription>{editDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-goal-outcome">{intentLabel}</Label>
            <Textarea
              id="edit-goal-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              rows={4}
            />
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {isRoutine ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-goal-schedule">Cadence</Label>
                  <Select
                    value={schedule}
                    onValueChange={(value) =>
                      setSchedule(value as ManagedGoalSchedule)
                    }
                  >
                    <SelectTrigger id="edit-goal-schedule">
                      <SelectValue placeholder="Choose schedule" />
                    </SelectTrigger>
                    <SelectContent>
                      {scheduleChoices.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <PreferredRunTimeFields
                  idPrefix="edit-loop"
                  time={preferredRunAt}
                  timezone={preferredRunTimeZone}
                  timezoneChoices={preferredRunTimeZoneChoices}
                  onTimeChange={updatePreferredRunAt}
                  onTimezoneChange={setPreferredRunTimeZone}
                />
                <div className="space-y-2">
                  <Label htmlFor="edit-loop-target-type">Target type</Label>
                  <Select
                    value={loopTargetType}
                    onValueChange={(value) => {
                      setLoopTargetType(value as ManagedLoopTarget["type"]);
                      setSelectedLoopGoalId(null);
                      setSelectedWorkflowId(null);
                      setSelectedCapabilitySlugs([]);
                    }}
                  >
                    <SelectTrigger id="edit-loop-target-type">
                      <SelectValue placeholder="Choose target type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="goal">Goal</SelectItem>
                      <SelectItem value="workflow">Workflow</SelectItem>
                      <SelectItem value="capability">Capability</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="edit-loop-target">Target</Label>
                  {loopTargetType === "goal" ? (
                    <SearchableSelect
                      id="edit-loop-target"
                      options={loopGoalOptions}
                      value={selectedLoopGoalId}
                      onChange={setSelectedLoopGoalId}
                      placeholder="Select goal"
                      searchPlaceholder="Search goals..."
                      emptyLabel="No goals found"
                    />
                  ) : loopTargetType === "workflow" ? (
                    <SearchableSelect
                      id="edit-loop-target"
                      options={workflowOptions}
                      value={selectedWorkflowId}
                      onChange={setSelectedWorkflowId}
                      placeholder={
                        workflowsLoading
                          ? "Loading workflows..."
                          : "Select workflow"
                      }
                      searchPlaceholder="Search workflows..."
                      emptyLabel="No workflows found"
                      disabled={workflowsLoading}
                    />
                  ) : (
                    <SearchableSelect
                      id="edit-loop-target"
                      options={capabilityOptions}
                      value={selectedLoopCapabilitySlug}
                      onChange={(next) =>
                        setSelectedCapabilitySlugs(next ? [next] : [])
                      }
                      placeholder="Select capability"
                      searchPlaceholder="Search capabilities..."
                      emptyLabel="No capabilities found"
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="min-w-0 space-y-2 md:col-span-2">
                <Label htmlFor="edit-agentGoal-capabilities">
                  Capabilities
                </Label>
                <SearchableMultiSelect
                  id="edit-agentGoal-capabilities"
                  options={capabilityOptions}
                  value={selectedCapabilitySlugs}
                  onChange={selectCapabilities}
                  placeholder="Select capabilities"
                  searchPlaceholder="Search capabilities..."
                  emptyLabel="No capabilities found"
                  selectedLabel="capabilities selected"
                  selectedSingularLabel="capability selected"
                  selectedHeading="Selected capabilities"
                  selectedTone="info"
                  maxVisibleSelected={4}
                />
                <OrderedPathSection
                  title="Route"
                  hint="The ordered path Kody follows to collect evidence."
                  route={routeSteps}
                  capabilitySlugs={selectedCapabilitySlugs}
                  onMove={moveSelectedCapability}
                />
              </div>
            )}
          </div>

          <SaveReportCheckbox
            id={
              isRoutine ? "edit-loop-save-report" : "edit-agentGoal-save-report"
            }
            checked={saveReport}
            onCheckedChange={setSaveReport}
            description={
              isRoutine
                ? "Writes each loop run under reports/<capability>/runs/."
                : "Writes each route capability output under reports/<capability>/runs/."
            }
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || updateGoal.isPending}
            >
              {updateGoal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoalRow({
  goal,
  isActive,
  onSelect,
  onDelete,
  label,
  kindLabel,
}: {
  goal: ManagedGoalRecord;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  label: string;
  kindLabel?: string;
}) {
  const done = completedEvidence(goal);
  const total = goal.state.destination.evidence.length;
  const step = currentRouteStep(goal);
  const storeBacked = isStoreBackedManagedGoal(goal);
  const canDelete = canDeleteManagedGoal(goal);
  const tone = goalActivityTone(goal.state.state);
  const kind = modelTypeLabel(goal);
  const loopTarget = managedLoopTarget(goal);

  return (
    <div
      className={cn(
        "relative flex items-stretch transition-colors",
        tone.rowClass,
        isActive && tone.selectedClass,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 px-4 py-3 text-left",
          canDelete && "pr-14",
        )}
      >
        <div className="flex items-center gap-2">
          <Target className={cn("w-3.5 h-3.5 shrink-0", tone.iconClass)} />
          <span className="font-mono text-sm truncate flex-1 text-white/90">
            {goal.id}
          </span>
          <GoalActivityBadge state={goal.state.state} />
          {storeBacked ? <StoreModelBadge label={label} /> : null}
        </div>

        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          {kindLabel ? (
            <>
              <span>
                {kindLabel}: {kind}
              </span>
              <span>·</span>
            </>
          ) : null}
          <span>{scheduleSummary(goal)}</span>
          {loopTarget ? (
            <>
              <span>·</span>
              <span>{loopTargetLabel(loopTarget)}</span>
            </>
          ) : null}
          <span>·</span>
          <span>
            {done}/{total} evidence
          </span>
          {step ? (
            <>
              <span>·</span>
              <span>{step.stage}</span>
            </>
          ) : null}
        </div>

        <p className="text-xs text-white/55 mt-1 truncate">
          {goal.state.destination.outcome}
        </p>
      </button>
      {canDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="absolute right-3 top-3 h-8 w-8 px-0 text-red-300 hover:text-red-200"
          title={`Delete ${label}`}
          aria-label={`Delete ${label} ${goal.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function GoalInstancesSection({
  goal,
  label,
}: {
  goal: ManagedGoalRecord;
  label: string;
}) {
  const instances = instanceSummaries(goal);
  const totalEvidence = goal.state.destination.evidence.length;

  return (
    <ContentSection
      icon={Clock3}
      title="Instances"
      subtitle={`Recent scheduled runs for this ${label}`}
      count={instances.length}
    >
      {instances.length ? (
        <div className="space-y-2">
          {instances.map((instance) => {
            const done = completedInstanceEvidence(goal, instance);
            const updatedAt = compactDateTime(instance.updatedAt);
            const createdAt = compactDateTime(instance.createdAt);
            const blockers = instance.blockers.length;

            return (
              <div
                key={instance.id}
                className="grid gap-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-white/80">
                      {instance.id}
                    </span>
                    {goal.state.latestInstanceId === instance.id ? (
                      <span className="text-[11px] uppercase tracking-wide text-sky-200">
                        Latest
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>created {createdAt}</span>
                    <span>·</span>
                    <span>updated {updatedAt}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground md:justify-end">
                  <span>{instance.state}</span>
                  <span>
                    {done}/{totalEvidence} evidence
                  </span>
                  {blockers ? (
                    <span className="text-amber-300">
                      {blockers} blocker(s)
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyHint text="No instances yet." />
      )}
    </ContentSection>
  );
}

function GoalDetail({
  goal,
  capabilities,
  copy,
  onBack,
  onActivate,
  onPause,
  onRun,
  onEdit,
  onDelete,
  isUpdating,
  isRunning,
}: {
  goal: ManagedGoalRecord;
  capabilities: CapabilitySummary[];
  copy: ManagedModelViewCopy;
  onBack: () => void;
  onActivate: () => void;
  onPause: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isRunning: boolean;
}) {
  const done = completedEvidence(goal);
  const total = goal.state.destination.evidence.length;
  const step = currentRouteStep(goal);
  const storeBacked = isStoreBackedManagedGoal(goal);
  const canDelete = canDeleteManagedGoal(goal);
  const tone = goalActivityTone(goal.state.state);
  const kind = modelTypeLabel(goal);
  const factEntries = goalFactEntries(goal);
  const isRoutine = managedGoalModel(goal) === "agentLoop";
  const loopTarget = managedLoopTarget(goal);
  const canActivate =
    goal.state.state === "inactive" || goal.state.state === "paused";
  const canPause = goal.state.state === "active";
  const canRun =
    goal.state.state === "active" || goal.state.state === "inactive";
  const runCapability = useRunCapability();

  return (
    <article className="min-h-full">
      <div className={cn("border-b", tone.headerClass)}>
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All {copy.plural}
          </Button>

          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono inline-flex items-center gap-3 flex-wrap">
                <span>{goal.id}</span>
                {storeBacked ? <StoreModelBadge label={copy.singular} /> : null}
                <GoalActivityBadge state={goal.state.state} />
                {copy.kindLabel ? (
                  <span
                    className="text-[11px] font-sans uppercase tracking-wide bg-white/[0.06] text-white/50 px-2 py-0.5 rounded"
                    title={copy.kindLabel}
                  >
                    {kind}
                  </span>
                ) : null}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {done}/{total} evidence
                </span>
                <span>·</span>
                <span>{scheduleSummary(goal)}</span>
                {goal.state.stage ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Route className="w-3 h-3" />
                      {goal.state.stage}
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span className="font-mono opacity-80">{goal.path}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onRun}
                disabled={!canRun || isRunning}
                className="h-8 w-8 px-0"
                title={
                  canRun
                    ? `Run ${copy.singular} now`
                    : `${copy.singular} cannot be run`
                }
                aria-label={`Run ${copy.singular} now`}
              >
                {isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </Button>

              {!storeBacked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  className="h-8 w-8 px-0"
                  title={`Edit ${copy.singular}`}
                  aria-label={`Edit ${copy.singular}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="h-8 w-8 px-0 text-red-300 hover:text-red-200"
                  title={`Delete ${copy.singular}`}
                  aria-label={`Delete ${copy.singular}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              ) : null}

              {canActivate ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onActivate}
                  disabled={isUpdating}
                  className="h-8 w-8 px-0"
                  title={`Activate ${copy.singular}`}
                  aria-label={`Activate ${copy.singular}`}
                >
                  {isUpdating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                </Button>
              ) : null}
              {canPause ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPause}
                  disabled={isUpdating}
                  className="h-8 w-8 px-0"
                  title={`Deactivate ${copy.singular}`}
                  aria-label={`Deactivate ${copy.singular}`}
                >
                  {isUpdating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PowerOff className="w-3.5 h-3.5" />
                  )}
                </Button>
              ) : null}
            </div>
          </header>

          <div
            className={cn("rounded-xl border p-4 md:p-5", tone.outcomeClass)}
          >
            <p className="text-sm text-white/80">
              {goal.state.destination.outcome}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {isRoutine ? (
          <ContentSection
            icon={Target}
            title="Target"
            subtitle="What this loop starts on schedule"
            count={loopTarget ? 1 : 0}
          >
            {loopTarget ? (
              <div className="rounded-md border border-white/[0.08] bg-black/20 px-3 py-3 text-sm">
                <div className="text-white/85">
                  {loopTargetLabel(loopTarget)}
                </div>
                <div className="mt-1 font-mono text-xs text-white/45">
                  {loopTarget.type}:{loopTarget.id}
                </div>
              </div>
            ) : (
              <EmptyHint text="No target selected." />
            )}
          </ContentSection>
        ) : null}

        {!isRoutine ||
        goal.state.capabilities.length > 0 ||
        Object.keys(goal.state.scheduleState?.capabilities ?? {}).length > 0 ? (
          <GoalCapabilitiesSection
            goal={goal}
            label={copy.singular}
            capabilities={capabilities}
            runningSlug={
              runCapability.isPending
                ? ((runCapability.variables as { slug?: string } | undefined)
                    ?.slug ?? null)
                : null
            }
            onRun={(slug) => runCapability.mutate({ slug, force: true })}
          />
        ) : null}
        <GoalInstancesSection goal={goal} label={copy.singular} />
        <ContentSection
          icon={isRoutine ? Clock3 : CheckCircle2}
          title={isRoutine ? "Health" : "Evidence"}
          subtitle={
            isRoutine
              ? "Runtime facts reported by agentLoop capabilities"
              : `What proves this ${copy.singular} is done`
          }
          count={
            isRoutine
              ? factEntries.length
              : goal.state.destination.evidence.length
          }
        >
          <div className="space-y-2">
            {isRoutine ? (
              factEntries.length ? (
                factEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-white/75">{key}</span>
                    <span className="truncate text-xs text-white/55">
                      {String(value)}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyHint text="No health facts reported yet." />
              )
            ) : (
              goal.state.destination.evidence.map((key) => {
                const complete = goal.state.facts[key] === true;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-white/75">{key}</span>
                    <span
                      className={cn(
                        "text-xs",
                        complete ? "text-emerald-300" : "text-white/40",
                      )}
                    >
                      {complete ? "done" : "open"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </ContentSection>

        {!isRoutine || goal.state.route.length > 0 ? (
          <ContentSection
            icon={Route}
            title="Route"
            subtitle="Capabilities used to collect evidence"
            count={goal.state.route.length}
          >
            <div className="space-y-2">
              {goal.state.route.map((routeStep) => (
                <Card
                  key={`${routeStep.stage}:${routeStep.evidence}`}
                  className={cn(
                    "border-white/[0.08] bg-white/[0.02]",
                    step?.evidence === routeStep.evidence &&
                      "border-sky-500/30 bg-sky-500/[0.05]",
                  )}
                >
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-white/85">
                        {routeStep.stage}
                      </span>
                      <span className="text-white/30">{"->"}</span>
                      <span className="font-mono text-white/65">
                        {routeStep.evidence}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                      <span>capability: {routeStep.capability}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ContentSection>
        ) : null}

        <ContentSection
          icon={ShieldAlert}
          title="Blockers"
          subtitle="Why the manager cannot advance"
          count={goal.state.blockers.length}
        >
          {goal.state.blockers.length ? (
            <ul className="space-y-2 text-sm text-amber-100/80">
              {goal.state.blockers.map((blocker, index) => (
                <li
                  key={`${blocker}-${index}`}
                  className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2"
                >
                  {blocker}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint text="No blockers." />
          )}
        </ContentSection>
      </div>
    </article>
  );
}

const scheduleEveryValues = new Set<ScheduleEvery>([
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
]);

function isScheduleEvery(value: unknown): value is ScheduleEvery {
  return (
    typeof value === "string" && scheduleEveryValues.has(value as ScheduleEvery)
  );
}

function capabilityCadenceLabel(value: string | null | undefined): string {
  if (isScheduleEvery(value)) return scheduleEveryLabel(value);
  if (value) return value;
  return "default cadence";
}

function compactDateTime(value: string | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function capabilityStateClass(state: string): string {
  if (state === "due") return "border-sky-400/25 bg-sky-400/10 text-sky-200";
  if (state === "waiting")
    return "border-white/10 bg-white/[0.04] text-white/60";
  if (state === "manual")
    return "border-violet-400/25 bg-violet-400/10 text-violet-200";
  if (state === "disabled")
    return "border-white/10 bg-white/[0.02] text-white/35";
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

function GoalCapabilitiesSection({
  goal,
  label,
  capabilities,
  runningSlug,
  onRun,
}: {
  goal: ManagedGoalRecord;
  label: string;
  capabilities: CapabilitySummary[];
  runningSlug: string | null;
  onRun: (slug: string) => void;
}) {
  const capabilityBySlug = useMemo(
    () =>
      new Map(capabilities.map((capability) => [capability.slug, capability])),
    [capabilities],
  );
  const scheduleCapabilities = useMemo(
    () => goal.state.scheduleState?.capabilities ?? {},
    [goal.state.scheduleState?.capabilities],
  );
  const capabilitySlugs = useMemo(() => {
    const ordered = new Set<string>();
    for (const slug of goal.state.capabilities) ordered.add(slug);
    for (const step of goal.state.route) ordered.add(step.capability);
    for (const slug of Object.keys(scheduleCapabilities)) ordered.add(slug);
    return Array.from(ordered);
  }, [goal.state.capabilities, goal.state.route, scheduleCapabilities]);
  const lastDecision = goal.state.scheduleState?.lastDecision;

  return (
    <ContentSection
      icon={Play}
      title="Capabilities"
      subtitle={`What this ${label} checks and chose last tick`}
      count={capabilitySlugs.length}
    >
      {lastDecision ? (
        <div className="mb-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="text-white/70">{lastDecision.kind}</span>
          <span className="mx-2 text-white/25">·</span>
          <span>{lastDecision.reason}</span>
        </div>
      ) : null}

      {capabilitySlugs.length ? (
        <div className="space-y-2">
          {capabilitySlugs.map((slug) => {
            const capability = capabilityBySlug.get(slug);
            const schedule = scheduleCapabilities[slug];
            const state = schedule?.state ?? "waiting";
            const title = schedule?.title ?? capability?.describe ?? slug;
            const cadence = schedule?.cadence ?? capability?.every ?? null;
            const reason =
              schedule?.reason ??
              (capability
                ? `Not selected by last ${label} tick`
                : "Capability not loaded");

            return (
              <div
                key={slug}
                className="grid gap-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white/85">
                      {title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                        capabilityStateClass(state),
                      )}
                    >
                      {state}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{slug}</span>
                    <span>{capabilityCadenceLabel(cadence)}</span>
                    <span>last {compactDateTime(schedule?.lastFiredAt)}</span>
                    <span>
                      next {compactDateTime(schedule?.nextEligibleAt)}
                    </span>
                  </div>
                  <p className="text-xs text-white/45">{reason}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRun(slug)}
                  disabled={runningSlug === slug}
                  className="h-8 w-8 px-0"
                  title={`Run ${slug}`}
                  aria-label={`Run ${slug}`}
                >
                  {runningSlug === slug ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyHint text="No capabilities are attached to this goal." />
      )}
    </ContentSection>
  );
}

function ContentSection({
  icon: Icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-4 h-4 mt-0.5 text-sky-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-white/90">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {typeof count === "number" ? (
          <span className="text-xs text-white/45 shrink-0">{count}</span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function ManagedModelsView({
  model,
  selectedId = null,
}: {
  model: ManagedGoalModel;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<ManagedGoalRecord | null>(
    null,
  );
  const [deleteGoal, setDeleteGoal] = useState<ManagedGoalRecord | null>(null);
  const [search, setSearch] = useState("");
  const {
    data: fetchedGoals,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useManagedGoals();
  const goals = useMemo(() => fetchedGoals ?? [], [fetchedGoals]);
  const goalsLoaded = fetchedGoals !== undefined;
  const { data: capabilities = [] } = useCapabilities();
  const setGoalState = useSetManagedGoalState();
  const runManagedGoal = useRunManagedGoal();
  const deleteManagedGoal = useDeleteManagedGoal();
  const copy = viewCopy[model];
  const basePath = model === "agentLoop" ? "/agent-loops" : "/agent-goals";
  const modelGoals = useMemo(
    () => goals.filter((goal) => managedGoalModel(goal) === model),
    [goals, model],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return modelGoals;
    return modelGoals.filter((goal) => goalSearchText(goal).includes(query));
  }, [modelGoals, search]);

  const selectedGoal = useMemo(
    () => modelGoals.find((goal) => goal.id === selectedId) ?? null,
    [modelGoals, selectedId],
  );
  const deleteGoalStoreBacked = deleteGoal
    ? isStoreBackedManagedGoal(deleteGoal)
    : false;

  useEffect(() => {
    if (isLoading || !goalsLoaded) return;
    if (filtered.length === 0) {
      if (selectedId) router.replace(basePath);
      return;
    }
    if (selectedId && !filtered.some((goal) => goal.id === selectedId)) {
      router.replace(basePath);
      return;
    }
    if (!selectedId && autoSelectFirst) {
      router.replace(selectionPath(basePath, filtered[0]!.id));
    }
  }, [
    autoSelectFirst,
    basePath,
    filtered,
    goalsLoaded,
    isLoading,
    router,
    selectedId,
  ]);

  const selectGoal = (id: string | null, replace = false) => {
    const path = id ? selectionPath(basePath, id) : basePath;
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title={copy.title}
        icon={Target}
        iconClassName="text-sky-400"
        subtitle={`${modelGoals.length} ${
          modelGoals.length === 1 ? copy.singular : copy.plural
        }`}
        error={
          error
            ? `Failed to load ${copy.plural}: ${(error as Error).message}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder={copy.searchPlaceholder}
        searchAriaLabel={copy.searchPlaceholder}
        accent="sky"
        hasSelection={!!selectedGoal}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label={`Refresh ${copy.plural}`}
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreateOpen(true)}
              title={copy.newLabel}
              aria-label={copy.newLabel}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedGoal ? (
            <GoalDetail
              goal={selectedGoal}
              capabilities={capabilities}
              copy={copy}
              onBack={() => selectGoal(null)}
              onEdit={() => setEditingGoal(selectedGoal)}
              onDelete={() => setDeleteGoal(selectedGoal)}
              onActivate={() =>
                setGoalState.mutate({
                  id: selectedGoal.id,
                  state: "active",
                })
              }
              onPause={() =>
                setGoalState.mutate({
                  id: selectedGoal.id,
                  state: "inactive",
                })
              }
              onRun={() => runManagedGoal.mutate(selectedGoal.id)}
              isUpdating={setGoalState.isPending}
              isRunning={
                runManagedGoal.isPending &&
                runManagedGoal.variables === selectedGoal.id
              }
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title={copy.selectTitle}
              hint={copy.selectHint}
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<FileText />} title={`Loading ${copy.plural}...`} />
        ) : modelGoals.length === 0 ? (
          <EmptyState
            icon={<CircleDot />}
            title={copy.emptyTitle}
            hint={copy.emptyHint}
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {copy.newLabel}
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title={`No matching ${copy.plural}`}
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((goal) => (
              <li key={goal.id}>
                <GoalRow
                  goal={goal}
                  isActive={selectedId === goal.id}
                  label={copy.singular}
                  kindLabel={copy.kindLabel}
                  onSelect={() => selectGoal(goal.id)}
                  onDelete={() => setDeleteGoal(goal)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <NewGoalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        model={model}
        label={copy.singular}
        goals={goals}
        onCreated={(goal) => selectGoal(goal.id)}
      />
      <EditManagedGoalDialog
        goal={editingGoal}
        open={!!editingGoal}
        label={copy.singular}
        capabilities={capabilities}
        goals={goals}
        onOpenChange={(open) => {
          if (!open) setEditingGoal(null);
        }}
      />
      <Dialog
        open={!!deleteGoal}
        onOpenChange={(open) => {
          if (!open) setDeleteGoal(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {copy.singular}?</DialogTitle>
            <DialogDescription>
              {deleteGoalStoreBacked
                ? `This removes the Store ${copy.singular} from this repo. It does not delete the Store template.`
                : `This removes the managed ${copy.singular} state file. It does not delete GitHub issues.`}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/75">
            {deleteGoal?.id}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteGoal(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-red-300 hover:text-red-200"
              disabled={!deleteGoal || deleteManagedGoal.isPending}
              onClick={() => {
                if (!deleteGoal) return;
                const id = deleteGoal.id;
                deleteManagedGoal.mutate(id, {
                  onSuccess: () => {
                    if (selectedId === id) selectGoal(null, true);
                    setDeleteGoal(null);
                  },
                });
              }}
            >
              {deleteManagedGoal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
