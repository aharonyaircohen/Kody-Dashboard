/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Engine managed goal contract. These goals live as one JSON file
 * per goal at `kody-state:.kody/goals/instances/<id>/state.json`.
 */

export type ManagedGoalStateValue = "inactive" | "active" | "paused" | "done";
export type ManagedGoalSchedule = "manual" | "1h" | "1d" | "7d" | "30d";
export type ManagedGoalTypeId = "improve" | "routine" | "release" | "checklist";
export type ManagedGoalModel = "objective" | "routine";

const LEGACY_ROUTINE_TYPE_IDS = new Set(["maintain", "monitor"]);

export const SIMPLE_MANAGED_GOAL_TEMPLATE = "simple";
export const SIMPLE_MANAGED_GOAL_EVIDENCE = "labelledTasksComplete";
export interface ManagedGoalTypeDefinition {
  id: ManagedGoalTypeId;
  model: ManagedGoalModel;
  label: string;
  description: string;
  bestFor: string;
  systemSummary: string;
  promptPlaceholder: string;
  evidence: string[];
  duties: string[];
  route: ManagedGoalRouteStep[];
}

export const MANAGED_GOAL_TYPES: ManagedGoalTypeDefinition[] = [
  {
    id: "improve",
    model: "objective",
    label: "Improve",
    description:
      "Change something in the product or codebase and verify the result.",
    bestFor: "Feature work, cleanup, UX improvements, and focused fixes.",
    systemSummary:
      "Kody plans the work, applies the change, and reviews the result.",
    promptPlaceholder:
      "Example: Make goal creation simple enough to use daily.",
    evidence: ["planReady", "changeImplemented", "changeVerified"],
    duties: ["plan", "fix", "review"],
    route: [
      {
        stage: "plan",
        evidence: "planReady",
        duty: "plan",
        executable: "plan",
      },
      {
        stage: "implement",
        evidence: "changeImplemented",
        duty: "fix",
        executable: "fix",
      },
      {
        stage: "review",
        evidence: "changeVerified",
        duty: "review",
        executable: "review",
      },
    ],
  },
  {
    id: "routine",
    model: "routine",
    label: "Routine",
    description:
      "Run recurring duties on schedule and surface health or drift.",
    bestFor:
      "Ongoing health, maintenance, QA sweeps, monitoring, and repo hygiene.",
    systemSummary:
      "Kody runs routine duties on selected schedule and records findings.",
    promptPlaceholder: "Example: Keep codebase healthy and report drift.",
    evidence: [],
    duties: [
      "cleanup",
      "code-health",
      "docs-health",
      "documentation-maintenance",
      "memory-compaction",
      "repo-graph",
      "skills-research",
      "health-check",
      "pr-health-triage",
      "qa-sweep",
    ],
    route: [],
  },

  {
    id: "release",
    model: "objective",
    label: "Release",
    description:
      "Prepare and publish a release while tracking the important proof points.",
    bestFor:
      "Web releases, production publishing, and release readiness checks.",
    systemSummary:
      "Kody tracks release PR, merge, and production deployment evidence.",
    promptPlaceholder: "Example: Publish Kody Dashboard to production safely.",
    evidence: ["releasePrExists", "mainMerged", "productionDeployed"],
    duties: ["release", "task-leader", "vercel-production-deploy"],
    route: [
      {
        stage: "release",
        evidence: "releasePrExists",
        duty: "release",
        executable: "release-prepare",
        args: {
          issue: { fact: "issue" },
          goal: "web-release",
        },
      },
      {
        stage: "merge",
        evidence: "mainMerged",
        duty: "task-leader",
        executable: "task-leader",
        args: {
          issue: { fact: "issue" },
        },
      },
      {
        stage: "publish",
        evidence: "productionDeployed",
        duty: "vercel-production-deploy",
        executable: "vercel-production-deploy",
      },
    ],
  },
  {
    id: "checklist",
    model: "objective",
    label: "Checklist",
    description:
      "Verify a concrete list of conditions and mark the goal complete when checked.",
    bestFor:
      "Readiness reviews, launch checks, and one-off verification lists.",
    systemSummary:
      "Kody verifies the requested checklist and records completion evidence.",
    promptPlaceholder: "Example: Verify release readiness before launch.",
    evidence: ["checklistComplete"],
    duties: ["task-verifier"],
    route: [
      {
        stage: "verify",
        evidence: "checklistComplete",
        duty: "task-verifier",
        executable: "task-verifier",
      },
    ],
  },
];

export interface ManagedGoalDestination {
  outcome: string;
  evidence: string[];
}

export interface ManagedGoalRouteStep {
  stage: string;
  evidence: string;
  duty: string;
  executable?: string;
  args?: Record<string, unknown>;
}

export interface ManagedGoalDutyScheduleStatus {
  slug: string;
  title?: string;
  cadence?: string;
  lastFiredAt?: string;
  nextEligibleAt?: string;
  state: "due" | "waiting" | "manual" | "disabled" | "blocked";
  reason: string;
}

export interface ManagedGoalDutyScheduleState {
  mode: "duty-cadence";
  lastGoalTickAt: string;
  lastDecision:
    | {
        kind: "dispatch";
        duty: string;
        executable: string;
        reason: string;
        at: string;
      }
    | { kind: "idle"; reason: string; at: string }
    | { kind: "blocked"; reason: string; at: string };
  duties: Record<string, ManagedGoalDutyScheduleStatus>;
}

export interface ManagedGoalState {
  version: 1;
  state: ManagedGoalStateValue;
  type: string;
  destination: ManagedGoalDestination;
  duties: string[];
  route: ManagedGoalRouteStep[];
  schedule?: ManagedGoalSchedule;
  stage?: string;
  facts: Record<string, unknown>;
  blockers: string[];
  scheduleMode?: "duty-cadence" | string;
  scheduleState?: ManagedGoalDutyScheduleState;
  latestInstanceId?: string;
  instanceCount?: number;
  instanceIds?: string[];
  instances?: ManagedGoalInstanceSummary[];
  [extraField: string]: unknown;
}

export interface ManagedGoalInstanceSummary {
  id: string;
  state: ManagedGoalStateValue;
  createdAt?: string;
  updatedAt?: string;
  stage?: string;
  facts: Record<string, unknown>;
  blockers: string[];
}

export interface ManagedGoalRecord {
  id: string;
  path: string;
  state: ManagedGoalState;
  source?: "local" | "store";
  recordType?: "instance" | "template";
  updatedAt?: string;
}

export function isStoreBackedManagedGoal(goal: ManagedGoalRecord): boolean {
  return (
    goal.source === "store" ||
    goal.state.kind === "template" ||
    goal.state.template === true ||
    typeof goal.state.sourceTemplate === "string"
  );
}

export function managedGoalModel(goal: ManagedGoalRecord): ManagedGoalModel {
  if (goal.state.scheduleMode === "duty-cadence") return "routine";
  if (LEGACY_ROUTINE_TYPE_IDS.has(goal.state.type)) return "routine";

  const goalType = MANAGED_GOAL_TYPES.find(
    (type) => type.id === goal.state.type,
  );
  if (goalType) return goalType.model;
  if (
    goal.state.route.length > 0 ||
    goal.state.destination.evidence.length > 0
  ) {
    return "objective";
  }

  return "routine";
}

function managedGoalRecordTime(goal: ManagedGoalRecord): string {
  const updatedAt =
    goal.updatedAt ??
    (typeof goal.state.updatedAt === "string" ? goal.state.updatedAt : "");
  const createdAt =
    typeof goal.state.createdAt === "string" ? goal.state.createdAt : "";
  return updatedAt || createdAt || "";
}

function managedGoalInstanceSummary(
  goal: ManagedGoalRecord,
): ManagedGoalInstanceSummary {
  return {
    id: goal.id,
    state: goal.state.state,
    ...(typeof goal.state.createdAt === "string"
      ? { createdAt: goal.state.createdAt }
      : {}),
    ...(typeof goal.state.updatedAt === "string"
      ? { updatedAt: goal.state.updatedAt }
      : {}),
    ...(typeof goal.state.stage === "string"
      ? { stage: goal.state.stage }
      : {}),
    facts: goal.state.facts,
    blockers: goal.state.blockers,
  };
}

export function collapseManagedGoalRecordsForList(
  goals: ManagedGoalRecord[],
): ManagedGoalRecord[] {
  const generatedByTemplate = new Map<string, ManagedGoalRecord[]>();
  const directGoals: ManagedGoalRecord[] = [];
  const directGoalById = new Map<string, ManagedGoalRecord>();

  for (const goal of goals) {
    const sourceTemplate =
      typeof goal.state.sourceTemplate === "string"
        ? goal.state.sourceTemplate.trim()
        : "";
    if (
      !sourceTemplate ||
      sourceTemplate === goal.id ||
      sourceTemplate === SIMPLE_MANAGED_GOAL_TEMPLATE
    ) {
      directGoals.push(goal);
      directGoalById.set(goal.id, goal);
      continue;
    }
    const existing = generatedByTemplate.get(sourceTemplate) ?? [];
    existing.push(goal);
    generatedByTemplate.set(sourceTemplate, existing);
  }

  const groupedTemplateIds = new Set(generatedByTemplate.keys());
  const groupedGoals = Array.from(generatedByTemplate.entries()).map(
    ([templateId, instances]) => {
      const sorted = [...instances].sort((a, b) =>
        managedGoalRecordTime(b).localeCompare(managedGoalRecordTime(a)),
      );
      const latest = sorted[0]!;
      const base = directGoalById.get(templateId) ?? latest;
      const instanceIds = instances.map((goal) => goal.id).sort();
      const instanceSummaries = sorted.map(managedGoalInstanceSummary);

      return {
        ...base,
        id: templateId,
        recordType: "template" as const,
        updatedAt: managedGoalRecordTime(base) || managedGoalRecordTime(latest),
        state: {
          ...base.state,
          state: base.state.state,
          sourceTemplate: templateId,
          latestInstanceId: latest.id,
          instanceCount: instances.length,
          instanceIds,
          instances: instanceSummaries,
        },
      };
    },
  );

  return [
    ...directGoals.filter((goal) => !groupedTemplateIds.has(goal.id)),
    ...groupedGoals,
  ].sort((a, b) => a.id.localeCompare(b.id));
}

export interface CreateManagedGoalInput {
  id?: string;
  templateId?: string;
  type: string;
  outcome: string;
  schedule?: ManagedGoalSchedule;
  duties?: string[];
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export interface SimpleManagedGoalCreateFields {
  id?: string;
  goalType: ManagedGoalTypeId;
  schedule: ManagedGoalSchedule;
  prompt: string;
  duties?: string[];
}

export interface UpdateManagedGoalInput {
  state?: Exclude<ManagedGoalStateValue, "done">;
  pausedReason?: string;
  type?: string;
  outcome?: string;
  schedule?: ManagedGoalSchedule;
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export function managedGoalPath(goalId: string): string {
  if (!goalId || /[\\/]/.test(goalId) || goalId.includes("..")) {
    throw new Error(`Invalid goalId path: ${JSON.stringify(goalId)}`);
  }
  return `.kody/goals/instances/${goalId}/state.json`;
}

export function slugifyManagedGoalId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeEvidenceKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 80);
}

export function isManagedGoalTypeId(
  value: unknown,
): value is ManagedGoalTypeId {
  return (
    typeof value === "string" &&
    MANAGED_GOAL_TYPES.some((type) => type.id === value)
  );
}

export function managedGoalTypeDefinition(
  id: ManagedGoalTypeId,
): ManagedGoalTypeDefinition {
  return MANAGED_GOAL_TYPES.find((type) => type.id === id)!;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function cloneRouteStep(step: ManagedGoalRouteStep): ManagedGoalRouteStep {
  return {
    stage: step.stage,
    evidence: step.evidence,
    duty: step.duty,
    ...(step.executable ? { executable: step.executable } : {}),
    ...(step.args ? { args: step.args } : {}),
  };
}

export function buildSimpleManagedGoalCreateInput(
  fields: SimpleManagedGoalCreateFields,
): CreateManagedGoalInput {
  return {
    ...(fields.id?.trim() ? { id: fields.id.trim() } : {}),
    type: fields.goalType,
    schedule: fields.schedule,
    outcome: fields.prompt.trim(),
    ...(fields.duties ? { duties: fields.duties } : {}),
  };
}

export function buildManagedGoalState(
  input: CreateManagedGoalInput,
): ManagedGoalState {
  const requestedGoalType = input.type.trim();
  if (
    input.templateId === SIMPLE_MANAGED_GOAL_TEMPLATE ||
    requestedGoalType === SIMPLE_MANAGED_GOAL_TEMPLATE
  ) {
    return {
      version: 1,
      state: "active",
      type: SIMPLE_MANAGED_GOAL_TEMPLATE,
      sourceTemplate: SIMPLE_MANAGED_GOAL_TEMPLATE,
      destination: {
        outcome: input.outcome.trim(),
        evidence: [SIMPLE_MANAGED_GOAL_EVIDENCE],
      },
      schedule: input.schedule ?? "manual",
      duties: [],
      route: [],
      stage: "waiting",
      facts: {
        ...(requestedGoalType &&
        requestedGoalType !== SIMPLE_MANAGED_GOAL_TEMPLATE
          ? { goalType: requestedGoalType }
          : {}),
        simpleAttachedTaskCount: 0,
        simpleOpenTaskCount: 0,
        [SIMPLE_MANAGED_GOAL_EVIDENCE]: false,
      },
      blockers: [],
    };
  }

  const selectedGoalType = isManagedGoalTypeId(requestedGoalType)
    ? managedGoalTypeDefinition(requestedGoalType)
    : null;
  const evidenceInput = input.evidence ?? selectedGoalType?.evidence ?? [];
  const routeInput = input.route ?? selectedGoalType?.route ?? [];
  const dutyInput = input.duties?.length
    ? input.duties
    : (selectedGoalType?.duties ?? []);
  const evidence = evidenceInput.map(normalizeEvidenceKey).filter(Boolean);
  const evidenceSet = new Set(evidence);
  const route = routeInput
    .map(cloneRouteStep)
    .map((step) => ({
      stage: step.stage.trim(),
      evidence: normalizeEvidenceKey(step.evidence),
      duty: step.duty.trim(),
      ...(step.executable?.trim()
        ? { executable: step.executable.trim() }
        : {}),
      ...(step.args ? { args: step.args } : {}),
    }))
    .filter(
      (step) =>
        step.stage &&
        step.evidence &&
        step.duty &&
        evidenceSet.has(step.evidence),
    );
  const duties = uniqueStrings([
    ...dutyInput,
    ...route.map((step) => step.duty),
  ]);

  return {
    version: 1,
    state: "active",
    type: input.type.trim() || "general",
    destination: {
      outcome: input.outcome.trim(),
      evidence,
    },
    schedule: input.schedule ?? "manual",
    duties,
    route,
    stage: route[0]?.stage,
    facts: selectedGoalType ? { goalType: selectedGoalType.id } : {},
    blockers: [],
  };
}

export function isManagedGoalState(value: unknown): value is ManagedGoalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const goal = value as Partial<ManagedGoalState>;
  return (
    goal.version === 1 &&
    typeof goal.state === "string" &&
    typeof goal.type === "string" &&
    !!goal.destination &&
    typeof goal.destination === "object" &&
    Array.isArray(
      (goal.destination as Partial<ManagedGoalDestination>).evidence,
    ) &&
    Array.isArray(goal.duties) &&
    Array.isArray(goal.route) &&
    !!goal.facts &&
    typeof goal.facts === "object" &&
    !Array.isArray(goal.facts) &&
    Array.isArray(goal.blockers)
  );
}
