/**
 * @fileType component
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Full managed-goals page backed by engine goal state files.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  FileText,
  Loader2,
  Pencil,
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

import {
  useCreateManagedGoal,
  useDeleteManagedGoal,
  useManagedGoals,
  useSetManagedGoalState,
  useUpdateManagedGoal,
} from "../hooks/useManagedGoals";
import type {
  CreateManagedGoalInput,
  ManagedGoalRecord,
  ManagedGoalSchedule,
  UpdateManagedGoalInput,
} from "../managed-goals";
import { cn } from "../utils";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";

interface EvidenceRow {
  id: string;
  evidence: string;
  stage: string;
  duty: string;
  executable: string;
}

const newRowId = () =>
  globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random()}`;

const blankRow = (): EvidenceRow => ({
  id: newRowId(),
  evidence: "",
  stage: "",
  duty: "",
  executable: "",
});

const templateRows = {
  simple: [
    {
      id: newRowId(),
      evidence: "goalVerified",
      stage: "verify",
      duty: "research",
      executable: "research",
    },
  ],
  docs: [
    {
      id: newRowId(),
      evidence: "docsChecked",
      stage: "docs-health",
      duty: "docs-health",
      executable: "docs-health",
    },
  ],
  plan: [
    {
      id: newRowId(),
      evidence: "planReady",
      stage: "plan",
      duty: "plan",
      executable: "plan",
    },
  ],
} satisfies Record<string, EvidenceRow[]>;

type GoalPresetId = "general" | "docs" | "plan";

interface GoalPreset {
  id: GoalPresetId;
  label: string;
  description: string;
  type: string;
  defaultOutcome: string;
  rows: EvidenceRow[];
}

const goalPresets = [
  {
    id: "general",
    label: "General check",
    description: "One normal verification step.",
    type: "general",
    defaultOutcome: "Goal is complete and verified.",
    rows: templateRows.simple,
  },
  {
    id: "docs",
    label: "Docs check",
    description: "Check documentation and report drift.",
    type: "docs",
    defaultOutcome: "Documentation is checked and any drift is reported.",
    rows: templateRows.docs,
  },
  {
    id: "plan",
    label: "Planning",
    description: "Produce a plan for the requested work.",
    type: "plan",
    defaultOutcome: "A plan exists for requested work.",
    rows: templateRows.plan,
  },
] satisfies GoalPreset[];
const defaultGoalPreset = goalPresets[0]!;

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

function cloneRows(rows: EvidenceRow[]): EvidenceRow[] {
  return rows.map((row) => ({ ...row, id: newRowId() }));
}

function slugifyGoalInput(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function newInstanceId(sourceId: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `${slugifyGoalInput(sourceId) || "goal"}-${stamp}`.slice(0, 80);
}

function rowsFromGoal(goal: ManagedGoalRecord): EvidenceRow[] {
  if (goal.state.route.length > 0) {
    return goal.state.route.map((step) => ({
      id: newRowId(),
      evidence: step.evidence,
      stage: step.stage,
      duty: step.duty,
      executable: step.executable ?? "",
    }));
  }
  return goal.state.destination.evidence.map((evidence) => ({
    id: newRowId(),
    evidence,
    stage: "",
    duty: "",
    executable: "",
  }));
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

function GoalStateText({ state }: { state: string }) {
  if (state === "active") return null;
  const label = state.charAt(0).toUpperCase() + state.slice(1);
  return (
    <span className="font-medium text-amber-200">{label}</span>
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
  instanceSources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceSources: ManagedGoalRecord[];
}) {
  const createGoal = useCreateManagedGoal();
  const [mode, setMode] = useState<"new" | "instance">("new");
  const [schedule, setSchedule] = useState<ManagedGoalSchedule>("manual");
  const [sourceId, setSourceId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [presetId, setPresetId] = useState<GoalPresetId>("general");
  const [type, setType] = useState("general");
  const [outcome, setOutcome] = useState("");
  const [rows, setRows] = useState<EvidenceRow[]>(
    cloneRows(templateRows.simple),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedPreset =
    goalPresets.find((preset) => preset.id === presetId) ?? defaultGoalPreset;
  const selectedSource = instanceSources.find((goal) => goal.id === sourceId);

  const validRows = useMemo(
    () =>
      rows.filter(
        (row) => row.evidence.trim() && row.stage.trim() && row.duty.trim(),
      ),
    [rows],
  );
  const canSubmit = outcome.trim().length > 0 && validRows.length > 0;

  const reset = () => {
    setMode("new");
    setSchedule("manual");
    setSourceId("");
    setGoalId("");
    setPresetId("general");
    setType("general");
    setOutcome("");
    setRows(cloneRows(templateRows.simple));
    setShowAdvanced(false);
  };

  const applyPreset = (nextPresetId: GoalPresetId) => {
    const nextPreset =
      goalPresets.find((preset) => preset.id === nextPresetId) ??
      defaultGoalPreset;
    setPresetId(nextPreset.id);
    setType(nextPreset.type);
    if (!outcome.trim()) setOutcome(nextPreset.defaultOutcome);
    setRows(cloneRows(nextPreset.rows));
  };

  const applyInstanceSource = (nextSourceId: string) => {
    const source = instanceSources.find((goal) => goal.id === nextSourceId);
    setSourceId(nextSourceId);
    if (!source) return;
    setGoalId(newInstanceId(source.id));
    setType(source.state.type || "general");
    setSchedule("manual");
    setOutcome(source.state.destination.outcome);
    setRows(rowsFromGoal(source));
    setShowAdvanced(false);
  };

  const updateRow = (id: string, patch: Partial<Omit<EvidenceRow, "id">>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((row) => row.id !== id),
    );
  };

  const submit = async () => {
    const payload: CreateManagedGoalInput = {
      ...(goalId.trim() ? { id: goalId.trim() } : {}),
      type: type.trim() || "general",
      outcome: outcome.trim(),
      schedule,
      evidence: validRows.map((row) => row.evidence.trim()),
      route: validRows.map((row) => ({
        stage: row.stage.trim(),
        evidence: row.evidence.trim(),
        duty: row.duty.trim(),
        ...(row.executable.trim() ? { executable: row.executable.trim() } : {}),
      })),
    };
    await createGoal.mutateAsync(payload);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>
            Write the finish line. Defaults handle the rest.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="goal-create-mode">Mode</Label>
              <Select
                value={mode}
                onValueChange={(value) => {
                const nextMode = value as "new" | "instance";
                setMode(nextMode);
                if (nextMode === "new") {
                  reset();
                } else if (instanceSources.length > 0) {
                  applyInstanceSource(sourceId || instanceSources[0]!.id);
                }
              }}
              >
                <SelectTrigger id="goal-create-mode">
                  <SelectValue placeholder="Choose mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New goal</SelectItem>
                  <SelectItem
                    value="instance"
                    disabled={instanceSources.length === 0}
                  >
                    New instance
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "instance" ? (
              <div className="space-y-2">
                <Label htmlFor="goal-instance-source">Goal</Label>
                <Select value={sourceId} onValueChange={applyInstanceSource}>
                  <SelectTrigger id="goal-instance-source">
                    <SelectValue placeholder="Choose goal" />
                  </SelectTrigger>
                  <SelectContent>
                    {instanceSources.map((goal) => (
                      <SelectItem key={goal.id} value={goal.id}>
                        {goal.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {mode === "new" ? (
              <div className="space-y-2">
                <Label htmlFor="goal-schedule">Schedule</Label>
                <Select
                  value={schedule}
                  onValueChange={(value) =>
                    setSchedule(value as ManagedGoalSchedule)
                  }
                >
                  <SelectTrigger id="goal-schedule">
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
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-outcome">Finish line</Label>
            <Textarea
              id="goal-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="Example: Users can create goals, attach tasks, and see progress update in the dashboard."
              className="min-h-32"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground">
            <span>
              {mode === "instance" && selectedSource
                ? `Instance from ${selectedSource.id}`
                : `Defaults: ${selectedPreset.label.toLowerCase()} · ${scheduleLabel(schedule)}`}{" "}
              ·{" "}
              {validRows.length} proof step
              {validRows.length === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced"}
            </Button>
          </div>

          {showAdvanced ? (
            <section className="space-y-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-2">
                  <Label htmlFor="goal-id">Name (optional)</Label>
                  <Input
                    id="goal-id"
                    value={goalId}
                    onChange={(event) => setGoalId(event.target.value)}
                    placeholder="verify-goals-page"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-preset">Goal type</Label>
                  <Select
                    value={presetId}
                    onValueChange={(value) =>
                      applyPreset(value as GoalPresetId)
                    }
                  >
                    <SelectTrigger id="goal-preset">
                      <SelectValue placeholder="Choose type" />
                    </SelectTrigger>
                    <SelectContent>
                      {goalPresets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-white/90">
                    Proof route
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only change this when the default route is wrong.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((prev) => [...prev, blankRow()])}
                >
                  <Plus className="h-4 w-4" />
                  Add proof
                </Button>
              </div>

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-white/[0.08] bg-black/20 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Proof {index + 1}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        aria-label="Remove proof"
                        className="h-7 w-7 px-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`evidence-${row.id}`}>Proof key</Label>
                        <Input
                          id={`evidence-${row.id}`}
                          value={row.evidence}
                          onChange={(event) =>
                            updateRow(row.id, { evidence: event.target.value })
                          }
                          placeholder="qaPassed"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`stage-${row.id}`}>Stage</Label>
                        <Input
                          id={`stage-${row.id}`}
                          value={row.stage}
                          onChange={(event) =>
                            updateRow(row.id, { stage: event.target.value })
                          }
                          placeholder="qa"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`duty-${row.id}`}>Duty</Label>
                        <Input
                          id={`duty-${row.id}`}
                          value={row.duty}
                          onChange={(event) =>
                            updateRow(row.id, { duty: event.target.value })
                          }
                          placeholder="qa-goal"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`executable-${row.id}`}>
                          Executable
                        </Label>
                        <Input
                          id={`executable-${row.id}`}
                          value={row.executable}
                          onChange={(event) =>
                            updateRow(row.id, {
                              executable: event.target.value,
                            })
                          }
                          placeholder="qa-goal"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="break-words font-mono text-xs text-white/45">
                .kody/goals/{goalId.trim() || "auto-name"}/state.json
              </p>
            </section>
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
              Create
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
}: {
  goal: ManagedGoalRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateGoal = useUpdateManagedGoal(goal?.id ?? "");
  const [type, setType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [schedule, setSchedule] = useState<ManagedGoalSchedule>("manual");
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!goal || !open) return;
    setType(goal.state.type);
    setOutcome(goal.state.destination.outcome);
    setSchedule(
      scheduleOptions.some((option) => option.value === goal.state.schedule)
        ? (goal.state.schedule as ManagedGoalSchedule)
        : "manual",
    );
    setRows(rowsFromGoal(goal));
    setShowAdvanced(false);
  }, [goal, open]);

  const validRows = useMemo(
    () =>
      rows.filter(
        (row) => row.evidence.trim() && row.stage.trim() && row.duty.trim(),
      ),
    [rows],
  );
  const canSubmit = !!goal && outcome.trim().length > 0;

  const updateRow = (id: string, patch: Partial<Omit<EvidenceRow, "id">>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((row) => row.id !== id),
    );
  };

  const submit = async () => {
    if (!goal) return;
    const payload: UpdateManagedGoalInput = {
      type: type.trim() || goal.state.type,
      outcome: outcome.trim(),
      schedule,
      ...(validRows.length > 0
        ? {
            evidence: validRows.map((row) => row.evidence.trim()),
            route: validRows.map((row) => ({
              stage: row.stage.trim(),
              evidence: row.evidence.trim(),
              duty: row.duty.trim(),
              ...(row.executable.trim()
                ? { executable: row.executable.trim() }
                : {}),
            })),
          }
        : {}),
    };
    await updateGoal.mutateAsync(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
          <DialogDescription>
            Update the finish line. Advanced settings are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-goal-outcome">Finish line</Label>
            <Textarea
              id="edit-goal-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className="min-h-32"
              autoFocus
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

          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground">
            <span>
              {goal?.id ?? "Goal"} · {scheduleLabel(schedule)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced"}
            </Button>
          </div>

          {showAdvanced ? (
            <section className="space-y-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="space-y-2">
                <Label htmlFor="edit-goal-type">Goal type</Label>
                <Input
                  id="edit-goal-type"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  placeholder="general"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-white/90">
                    Proof route
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only change when the current route is wrong.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((prev) => [...prev, blankRow()])}
                >
                  <Plus className="h-4 w-4" />
                  Add proof
                </Button>
              </div>

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-white/[0.08] bg-black/20 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Proof {index + 1}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        aria-label="Remove proof"
                        className="h-7 w-7 px-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`edit-evidence-${row.id}`}>
                          Proof key
                        </Label>
                        <Input
                          id={`edit-evidence-${row.id}`}
                          value={row.evidence}
                          onChange={(event) =>
                            updateRow(row.id, { evidence: event.target.value })
                          }
                          placeholder="qaPassed"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-stage-${row.id}`}>Stage</Label>
                        <Input
                          id={`edit-stage-${row.id}`}
                          value={row.stage}
                          onChange={(event) =>
                            updateRow(row.id, { stage: event.target.value })
                          }
                          placeholder="qa"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-duty-${row.id}`}>Duty</Label>
                        <Input
                          id={`edit-duty-${row.id}`}
                          value={row.duty}
                          onChange={(event) =>
                            updateRow(row.id, { duty: event.target.value })
                          }
                          placeholder="qa-goal"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`edit-executable-${row.id}`}>
                          Executable
                        </Label>
                        <Input
                          id={`edit-executable-${row.id}`}
                          value={row.executable}
                          onChange={(event) =>
                            updateRow(row.id, {
                              executable: event.target.value,
                            })
                          }
                          placeholder="qa-goal"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
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
}: {
  goal: ManagedGoalRecord;
  isActive: boolean;
  onSelect: () => void;
}) {
  const done = completedEvidence(goal);
  const total = goal.state.destination.evidence.length;
  const step = currentRouteStep(goal);

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
        <Target
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            isActive ? "text-sky-400" : "text-muted-foreground",
          )}
        />
        <span className="font-mono text-sm truncate flex-1 text-white/90">
          {goal.id}
        </span>
        {goal.source === "store" ? (
          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            Store
          </span>
        ) : null}
      </div>

        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <span>{goal.state.type}</span>
          <span>·</span>
          <span>{scheduleLabel(goal.state.schedule)}</span>
          {goal.state.state !== "active" ? (
            <>
              <span>·</span>
              <GoalStateText state={goal.state.state} />
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
  );
}

function GoalDetail({
  goal,
  onBack,
  onActivate,
  onPause,
  onEdit,
  onDelete,
  isUpdating,
}: {
  goal: ManagedGoalRecord;
  onBack: () => void;
  onActivate: () => void;
  onPause: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const done = completedEvidence(goal);
  const total = goal.state.destination.evidence.length;
  const step = currentRouteStep(goal);
  const canActivate =
    goal.state.state === "inactive" || goal.state.state === "paused";
  const canPause = goal.state.state === "active";

  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-sky-500/[0.06] via-sky-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All goals
          </Button>

          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono inline-flex items-center gap-3 flex-wrap">
                <span>{goal.id}</span>
                {goal.source === "store" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Store
                  </span>
                ) : null}
                <span className="text-[11px] font-sans uppercase tracking-wide bg-white/[0.06] text-white/50 px-2 py-0.5 rounded">
                  {goal.state.type}
                </span>
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {done}/{total} evidence
            </span>
            <span>·</span>
            <span>{scheduleLabel(goal.state.schedule)}</span>
            {goal.state.state !== "active" ? (
                  <>
                    <span>·</span>
                    <GoalStateText state={goal.state.state} />
                  </>
                ) : null}
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
            {goal.source !== "store" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  className="h-8 w-8 px-0"
                  title="Edit goal"
                  aria-label="Edit goal"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="h-8 w-8 px-0 text-red-300 hover:text-red-200"
                  title="Delete goal"
                  aria-label="Delete goal"
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
              title="Activate goal"
              aria-label="Activate goal"
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
              title="Pause goal"
              aria-label="Pause goal"
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

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
            <p className="text-sm text-white/80">
              {goal.state.destination.outcome}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        <ContentSection
          icon={CheckCircle2}
          title="Evidence"
          subtitle="What proves this goal is done"
          count={goal.state.destination.evidence.length}
        >
          <div className="space-y-2">
            {goal.state.destination.evidence.map((key) => {
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
            })}
          </div>
        </ContentSection>

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

export function ManagedGoalsView() {
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
  const setGoalState = useSetManagedGoalState();
  const deleteManagedGoal = useDeleteManagedGoal();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return goals;
    return goals.filter((goal) => goalSearchText(goal).includes(query));
  }, [goals, search]);

  const selectedGoal = useMemo(
    () => goals.find((goal) => goal.id === selectedId) ?? null,
    [goals, selectedId],
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
        title="Goals"
        icon={Target}
        iconClassName="text-sky-400"
        subtitle={`${goals.length} ${goals.length === 1 ? "goal" : "goals"}`}
        error={
          error ? `Failed to load goals: ${(error as Error).message}` : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search goals..."
        searchAriaLabel="Search goals"
        accent="sky"
        hasSelection={!!selectedGoal}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh goals"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreateOpen(true)}
              title="New goal"
              aria-label="New goal"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedGoal ? (
            <GoalDetail
              goal={selectedGoal}
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
                  state: "paused",
                  pausedReason: "Paused from dashboard",
                })
              }
              isUpdating={setGoalState.isPending}
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a goal"
              hint="Choose a goal from the list."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<FileText />} title="Loading goals..." />
        ) : goals.length === 0 ? (
          <EmptyState
            icon={<CircleDot />}
            title="No goals yet"
            hint="Create the first engine-managed goal for this repo."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New goal
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No matching goals"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((goal) => (
              <li key={goal.id}>
                <GoalRow
                  goal={goal}
                  isActive={selectedId === goal.id}
                  onSelect={() => setSelectedId(goal.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <NewGoalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        instanceSources={goals}
      />
      <EditManagedGoalDialog
        goal={editingGoal}
        open={!!editingGoal}
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
            <DialogTitle>Delete goal?</DialogTitle>
            <DialogDescription>
              This removes the managed goal state file. It does not delete
              GitHub issues.
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
