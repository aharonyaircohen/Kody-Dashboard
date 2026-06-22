/**
 * @fileType component
 * @domain kody
 * @pattern managed-models
 * @ai-summary Shared Objective/Routine page backed by engine state files.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
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

import type { Duty } from "../api";
import { useDuties, useRunDuty } from "../hooks/useDuties";
import {
  useCreateManagedGoal,
  useDeleteManagedGoal,
  useManagedGoals,
  useRunManagedGoal,
  useSetManagedGoalState,
  useUpdateManagedGoal,
} from "../hooks/useManagedGoals";
import {
  MANAGED_GOAL_TYPES,
  buildSimpleManagedGoalCreateInput,
  isStoreBackedManagedGoal,
  managedGoalModel,
  type ManagedGoalInstanceSummary,
  type ManagedGoalModel,
  type ManagedGoalRecord,
  type ManagedGoalSchedule,
  type ManagedGoalTypeId,
} from "../managed-goals";
import { scheduleEveryLabel, type ScheduleEvery } from "../ticked/frontmatter";
import { cn } from "../utils";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import {
  SearchableMultiSelect,
  type SearchableSelectOption,
} from "./SearchableSelect";

const defaultGoalType = MANAGED_GOAL_TYPES[0]!;

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
  objective: {
    title: "Objectives",
    singular: "objective",
    plural: "objectives",
    kindLabel: "Objective type",
    selectTitle: "Select an objective",
    selectHint: "Choose an objective from the list.",
    emptyTitle: "No objectives yet",
    emptyHint: "Create the first evidence-driven objective for this repo.",
    searchPlaceholder: "Search objectives...",
    newLabel: "New objective",
  },
  routine: {
    title: "Routines",
    singular: "routine",
    plural: "routines",
    kindLabel: "Routine type",
    selectTitle: "Select a routine",
    selectHint: "Choose a routine from the list.",
    emptyTitle: "No routines yet",
    emptyHint:
      "Create the first schedule or health driven routine for this repo.",
    searchPlaceholder: "Search routines...",
    newLabel: "New routine",
  },
};

const scheduleOptions = [
  { value: "manual", label: "Manual" },
  { value: "1h", label: "Every hour" },
  { value: "1d", label: "Every day" },
  { value: "7d", label: "Every week" },
  { value: "30d", label: "Every month" },
] satisfies { value: ManagedGoalSchedule; label: string }[];

function scheduleLabel(schedule: unknown): string {
  return (
    scheduleOptions.find((option) => option.value === schedule)?.label ??
    "Manual"
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
  return [
    goal.id,
    goal.source ?? "",
    goal.recordType ?? "",
    goal.state.type,
    scheduleLabel(goal.state.schedule),
    goal.state.state,
    goal.state.stage ?? "",
    goal.state.destination.outcome,
    ...goal.state.destination.evidence,
    ...goal.state.duties,
    ...goal.state.route.flatMap((step) => [
      step.stage,
      step.evidence,
      step.duty,
      step.executable ?? "",
    ]),
    ...goal.state.blockers,
  ]
    .join(" ")
    .toLowerCase();
}

function NewGoalDialog({
  open,
  onOpenChange,
  model,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ManagedGoalModel;
  label: string;
}) {
  const createGoal = useCreateManagedGoal();
  const { data: duties = [], isLoading: dutiesLoading } = useDuties();
  const goalTypes = useMemo(
    () => MANAGED_GOAL_TYPES.filter((type) => type.model === model),
    [model],
  );
  const defaultType = goalTypes[0] ?? defaultGoalType;
  const isRoutine = model === "routine";
  const defaultSchedule: ManagedGoalSchedule = isRoutine ? "1d" : "manual";
  const [goalType, setGoalType] = useState<ManagedGoalTypeId>(defaultType.id);
  const [schedule, setSchedule] =
    useState<ManagedGoalSchedule>(defaultSchedule);
  const [outcome, setOutcome] = useState("");
  const [selectedDutySlugs, setSelectedDutySlugs] = useState<string[]>(
    defaultType.duties,
  );

  const selectedGoalType =
    goalTypes.find((type) => type.id === goalType) ?? defaultType;
  const scheduleChoices = isRoutine
    ? scheduleOptions.filter((option) => option.value !== "manual")
    : scheduleOptions;
  const routineDutyOptions = useMemo<SearchableSelectOption[]>(() => {
    const bySlug = new Map<string, SearchableSelectOption>();
    for (const slug of selectedGoalType.duties) {
      bySlug.set(slug, {
        value: slug,
        label: slug,
        searchText: slug,
      });
    }
    for (const duty of duties) {
      const label = duty.title || duty.slug;
      const source = duty.source ? ` / ${duty.source}` : "";
      bySlug.set(duty.slug, {
        value: duty.slug,
        label,
        description: `${duty.slug}${source}`,
        searchText: `${label} ${duty.slug} ${duty.source ?? ""}`,
      });
    }
    return Array.from(bySlug.values()).sort((a, b) =>
      (a.value ?? "").localeCompare(b.value ?? ""),
    );
  }, [duties, selectedGoalType.duties]);
  const canSubmit =
    outcome.trim().length > 0 && (!isRoutine || selectedDutySlugs.length > 0);
  const showTypeSelect = !isRoutine && goalTypes.length > 1;
  const intentLabel = isRoutine ? "Scope" : "Finish line";
  const dialogDescription = isRoutine
    ? "Create one ongoing loop with a clear scope, cadence, and duties."
    : "Define the finish line and evidence Kody must close.";
  const intentPlaceholder = isRoutine
    ? "Example: Keep codebase healthy and surface drift."
    : selectedGoalType.promptPlaceholder;

  useEffect(() => {
    if (!goalTypes.some((type) => type.id === goalType)) {
      setGoalType(defaultType.id);
    }
  }, [defaultType.id, goalType, goalTypes]);

  useEffect(() => {
    if (isRoutine) {
      setSelectedDutySlugs(selectedGoalType.duties);
    }
  }, [isRoutine, selectedGoalType]);

  useEffect(() => {
    if (isRoutine && schedule === "manual") {
      setSchedule(defaultSchedule);
    }
    if (!isRoutine && schedule !== "manual") {
      setSchedule("manual");
    }
  }, [defaultSchedule, isRoutine, schedule]);

  const reset = () => {
    setGoalType(defaultType.id);
    setSchedule(defaultSchedule);
    setOutcome("");
    setSelectedDutySlugs(defaultType.duties);
  };

  const submit = async () => {
    await createGoal.mutateAsync(
      buildSimpleManagedGoalCreateInput({
        goalType,
        schedule,
        prompt: outcome,
        ...(isRoutine ? { duties: selectedDutySlugs } : {}),
      }),
    );
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden sm:w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New {label}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {isRoutine ? (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-200">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Routine loop
                </p>
                <p className="text-xs text-muted-foreground">
                  Runs on cadence, updates health state, keeps duties attached.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="min-w-0 space-y-4">
          {isRoutine ? (
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
          ) : null}

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              {showTypeSelect ? (
                <div className="space-y-2">
                  <Label htmlFor="goal-type">Objective type</Label>
                  <Select
                    value={goalType}
                    onValueChange={(value) =>
                      setGoalType(value as ManagedGoalTypeId)
                    }
                  >
                    <SelectTrigger id="goal-type">
                      <SelectValue placeholder="Choose type" />
                    </SelectTrigger>
                    <SelectContent>
                      {goalTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {isRoutine ? (
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
              ) : (
                <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {selectedGoalType.description}
                  </p>
                  <p>
                    <span className="text-foreground/70">Best for: </span>
                    {selectedGoalType.bestFor}
                  </p>
                  <p>
                    <span className="text-foreground/70">Kody will: </span>
                    {selectedGoalType.systemSummary}
                  </p>
                </div>
              )}
            </div>

            {isRoutine ? (
              <div className="min-w-0 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="routine-duties">Duties</Label>
                  <SearchableMultiSelect
                    id="routine-duties"
                    options={routineDutyOptions}
                    value={selectedDutySlugs}
                    onChange={setSelectedDutySlugs}
                    placeholder={
                      dutiesLoading ? "Loading duties..." : "Select duties"
                    }
                    searchPlaceholder="Search duties..."
                    emptyLabel="No duties found"
                    disabled={dutiesLoading}
                    selectedLabel="duties selected"
                    maxVisibleSelected={4}
                  />
                </div>
              </div>
            ) : (
              <div className="min-w-0 space-y-3">
                <div className="space-y-2 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white/65">Missing evidence</p>
                    <span className="font-mono text-white/45">
                      {selectedGoalType.evidence.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedGoalType.evidence.map((evidence) => (
                      <div
                        key={evidence}
                        className="flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
                      >
                        <CircleDot className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                        <span className="font-mono text-white/70">
                          {evidence}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white/65">Route</p>
                    <span className="font-mono text-white/45">
                      {selectedGoalType.route.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedGoalType.route.map((step) => (
                      <div
                        key={`${step.stage}:${step.evidence}`}
                        className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
                      >
                        <div className="flex items-center gap-2 text-white/75">
                          <Route className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                          <span>{step.stage}</span>
                          <span className="text-white/30">{"->"}</span>
                          <span className="font-mono">{step.evidence}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-white/45">
                          duty: {step.duty}
                          {step.executable
                            ? ` · executable: ${step.executable}`
                            : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isRoutine ? (
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
          ) : null}

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
              {isRoutine ? "Create routine" : `Create ${label}`}
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
}: {
  goal: ManagedGoalRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
}) {
  const updateGoal = useUpdateManagedGoal(goal?.id ?? "");
  const isRoutine = goal ? managedGoalModel(goal) === "routine" : false;
  const intentLabel = isRoutine ? "Routine scope" : "Finish line";
  const editDescription = isRoutine
    ? "Update routine scope and cadence."
    : "Update finish line and schedule.";
  const [outcome, setOutcome] = useState("");
  const [schedule, setSchedule] = useState<ManagedGoalSchedule>("manual");

  useEffect(() => {
    if (!goal || !open) return;
    setOutcome(goal.state.destination.outcome);
    setSchedule(
      scheduleOptions.some((option) => option.value === goal.state.schedule)
        ? (goal.state.schedule as ManagedGoalSchedule)
        : "manual",
    );
  }, [goal, open]);

  const canSubmit = !!goal && outcome.trim().length > 0;

  const submit = async () => {
    if (!goal) return;
    await updateGoal.mutateAsync({
      type: goal.state.type,
      outcome: outcome.trim(),
      schedule,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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

          <div className="space-y-2">
            <Label htmlFor="edit-goal-schedule">Schedule</Label>
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
                {scheduleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
  const tone = goalActivityTone(goal.state.state);
  const kind = modelTypeLabel(goal);

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
          !storeBacked && "pr-14",
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
          <span>{scheduleLabel(goal.state.schedule)}</span>
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
      {!storeBacked ? (
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
  duties,
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
  duties: Duty[];
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
  const tone = goalActivityTone(goal.state.state);
  const kind = modelTypeLabel(goal);
  const factEntries = goalFactEntries(goal);
  const isRoutine = managedGoalModel(goal) === "routine";
  const canActivate =
    goal.state.state === "inactive" || goal.state.state === "paused";
  const canPause = goal.state.state === "active";
  const canRun =
    goal.state.state === "active" || goal.state.state === "inactive";
  const runDuty = useRunDuty();

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
                <span
                  className="text-[11px] font-sans uppercase tracking-wide bg-white/[0.06] text-white/50 px-2 py-0.5 rounded"
                  title={copy.kindLabel}
                >
                  {kind}
                </span>
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {done}/{total} evidence
                </span>
                <span>·</span>
                <span>{scheduleLabel(goal.state.schedule)}</span>
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
                <>
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
                </>
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
        <GoalDutiesSection
          goal={goal}
          label={copy.singular}
          duties={duties}
          runningSlug={
            runDuty.isPending
              ? ((runDuty.variables as { slug?: string } | undefined)?.slug ??
                null)
              : null
          }
          onRun={(slug) => runDuty.mutate({ slug, force: true })}
        />
        <GoalInstancesSection goal={goal} label={copy.singular} />
        <ContentSection
          icon={isRoutine ? Clock3 : CheckCircle2}
          title={isRoutine ? "Health" : "Evidence"}
          subtitle={
            isRoutine
              ? "Runtime facts reported by routine duties"
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
            subtitle="Duties and executables used to collect evidence"
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
                      <span>duty: {routeStep.duty}</span>
                      {routeStep.executable ? (
                        <>
                          <span>·</span>
                          <span>executable: {routeStep.executable}</span>
                        </>
                      ) : null}
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

function dutyCadenceLabel(value: string | null | undefined): string {
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

function dutyStateClass(state: string): string {
  if (state === "due") return "border-sky-400/25 bg-sky-400/10 text-sky-200";
  if (state === "waiting")
    return "border-white/10 bg-white/[0.04] text-white/60";
  if (state === "manual")
    return "border-violet-400/25 bg-violet-400/10 text-violet-200";
  if (state === "disabled")
    return "border-white/10 bg-white/[0.02] text-white/35";
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

function GoalDutiesSection({
  goal,
  label,
  duties,
  runningSlug,
  onRun,
}: {
  goal: ManagedGoalRecord;
  label: string;
  duties: Duty[];
  runningSlug: string | null;
  onRun: (slug: string) => void;
}) {
  const dutyBySlug = useMemo(
    () => new Map(duties.map((duty) => [duty.slug, duty])),
    [duties],
  );
  const scheduleDuties = goal.state.scheduleState?.duties ?? {};
  const dutySlugs = useMemo(() => {
    const ordered = new Set<string>();
    for (const slug of goal.state.duties) ordered.add(slug);
    for (const step of goal.state.route) ordered.add(step.duty);
    for (const slug of Object.keys(scheduleDuties)) ordered.add(slug);
    return Array.from(ordered);
  }, [goal.state.duties, goal.state.route, scheduleDuties]);
  const lastDecision = goal.state.scheduleState?.lastDecision;

  return (
    <ContentSection
      icon={Play}
      title="Duties"
      subtitle={`What this ${label} checks and chose last tick`}
      count={dutySlugs.length}
    >
      {lastDecision ? (
        <div className="mb-3 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="text-white/70">{lastDecision.kind}</span>
          <span className="mx-2 text-white/25">·</span>
          <span>{lastDecision.reason}</span>
        </div>
      ) : null}

      {dutySlugs.length ? (
        <div className="space-y-2">
          {dutySlugs.map((slug) => {
            const duty = dutyBySlug.get(slug);
            const schedule = scheduleDuties[slug];
            const state =
              schedule?.state ??
              (duty?.disabled
                ? "disabled"
                : duty?.schedule === "manual"
                  ? "manual"
                  : "waiting");
            const title = schedule?.title ?? duty?.title ?? slug;
            const cadence = schedule?.cadence ?? duty?.schedule ?? null;
            const reason =
              schedule?.reason ??
              (duty ? `Not selected by last ${label} tick` : "Duty not loaded");

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
                        dutyStateClass(state),
                      )}
                    >
                      {state}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{slug}</span>
                    <span>{dutyCadenceLabel(cadence)}</span>
                    <span>
                      last{" "}
                      {compactDateTime(
                        schedule?.lastFiredAt ?? duty?.lastTickAt,
                      )}
                    </span>
                    <span>
                      next{" "}
                      {compactDateTime(
                        schedule?.nextEligibleAt ?? duty?.nextEligibleAt,
                      )}
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
        <EmptyHint text="No duties are attached to this goal." />
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

export function ManagedModelsView({ model }: { model: ManagedGoalModel }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<ManagedGoalRecord | null>(
    null,
  );
  const [deleteGoal, setDeleteGoal] = useState<ManagedGoalRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const {
    data: goals = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useManagedGoals();
  const { data: duties = [] } = useDuties();
  const setGoalState = useSetManagedGoalState();
  const runManagedGoal = useRunManagedGoal();
  const deleteManagedGoal = useDeleteManagedGoal();
  const copy = viewCopy[model];
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

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((goal) => goal.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

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
              duties={duties}
              copy={copy}
              onBack={() => setSelectedId(null)}
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
                  onSelect={() => setSelectedId(goal.id)}
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
      />
      <EditManagedGoalDialog
        goal={editingGoal}
        open={!!editingGoal}
        label={copy.singular}
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
            <DialogTitle>Delete {copy.singular}?</DialogTitle>
            <DialogDescription>
              This removes the managed {copy.singular} state file. It does not
              delete GitHub issues.
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
                    if (selectedId === id) setSelectedId(null);
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
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
