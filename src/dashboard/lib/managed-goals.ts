/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Engine managed goal contract. These goals live as one JSON file
 * per goal at `<statePath>/goals/instances/<id>/state.json`.
 */

export type ManagedGoalStateValue = "inactive" | "active" | "paused" | "done";
export type ManagedGoalSchedule = "manual" | "1h" | "1d" | "7d" | "30d";
export interface ManagedGoalPreferredRunTime {
  time: string;
  timezone: string;
}
export type ManagedLoopTargetType = "agentResponsibility" | "goal";
export interface ManagedLoopTarget {
  type: ManagedLoopTargetType;
  id: string;
}
export type ManagedGoalTypeId =
  | "improve"
  | "agentLoop"
  | "release"
  | "checklist";
export type ManagedGoalModel = "agentGoal" | "agentLoop";

const LEGACY_ROUTINE_TYPE_IDS = new Set(["maintain", "monitor", "routine"]);

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
  agentResponsibilities: string[];
  route: ManagedGoalRouteStep[];
}

export const MANAGED_GOAL_TYPES: ManagedGoalTypeDefinition[] = [
  {
    id: "improve",
    model: "agentGoal",
    label: "Improve",
    description:
      "Change something in the product or codebase and verify the result.",
    bestFor: "Feature work, cleanup, UX improvements, and focused fixes.",
    systemSummary:
      "Kody plans the work, applies the change, and reviews the result.",
    promptPlaceholder:
      "Example: Make goal creation simple enough to use daily.",
    evidence: ["planReady", "changeImplemented", "changeVerified"],
    agentResponsibilities: ["plan", "fix", "review"],
    route: [
      {
        stage: "plan",
        evidence: "planReady",
        agentResponsibility: "plan",
        agentAction: "plan",
      },
      {
        stage: "implement",
        evidence: "changeImplemented",
        agentResponsibility: "fix",
        agentAction: "fix",
      },
      {
        stage: "review",
        evidence: "changeVerified",
        agentResponsibility: "review",
        agentAction: "review",
      },
    ],
  },
  {
    id: "agentLoop",
    model: "agentLoop",
    label: "AgentLoop",
    description:
      "Run recurring agentResponsibilities on schedule and surface health or drift.",
    bestFor:
      "Ongoing health, maintenance, QA sweeps, monitoring, and repo hygiene.",
    systemSummary:
      "Kody runs agentLoop agentResponsibilities on selected schedule and records findings.",
    promptPlaceholder: "Example: Keep codebase healthy and report drift.",
    evidence: [],
    agentResponsibilities: [
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
    model: "agentGoal",
    label: "Release",
    description:
      "Prepare and publish a release while tracking the important proof points.",
    bestFor:
      "Web releases, production publishing, and release readiness checks.",
    systemSummary:
      "Kody tracks release PR, merge, and production deployment evidence.",
    promptPlaceholder: "Example: Publish Kody Dashboard to production safely.",
    evidence: ["releasePrExists", "mainMerged", "productionDeployed"],
    agentResponsibilities: [
      "release",
      "task-leader",
      "vercel-production-deploy",
    ],
    route: [
      {
        stage: "release",
        evidence: "releasePrExists",
        agentResponsibility: "release",
        agentAction: "release-prepare",
        args: {
          issue: { fact: "issue" },
          goal: "web-release",
        },
      },
      {
        stage: "merge",
        evidence: "mainMerged",
        agentResponsibility: "task-leader",
        agentAction: "task-leader",
        args: {
          issue: { fact: "issue" },
        },
      },
      {
        stage: "publish",
        evidence: "productionDeployed",
        agentResponsibility: "vercel-production-deploy",
        agentAction: "vercel-production-deploy",
      },
    ],
  },
  {
    id: "checklist",
    model: "agentGoal",
    label: "Checklist",
    description:
      "Verify a concrete list of conditions and mark the goal complete when checked.",
    bestFor:
      "Readiness reviews, launch checks, and one-off verification lists.",
    systemSummary:
      "Kody verifies the requested checklist and records completion evidence.",
    promptPlaceholder: "Example: Verify release readiness before launch.",
    evidence: ["checklistComplete"],
    agentResponsibilities: ["task-verifier"],
    route: [
      {
        stage: "verify",
        evidence: "checklistComplete",
        agentResponsibility: "task-verifier",
        agentAction: "task-verifier",
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
  agentResponsibility: string;
  agentAction?: string;
  saveReport?: boolean;
  args?: Record<string, unknown>;
}

export interface ManagedGoalAgentResponsibilityScheduleStatus {
  slug: string;
  title?: string;
  cadence?: string;
  lastFiredAt?: string;
  nextEligibleAt?: string;
  state: "due" | "waiting" | "manual" | "disabled" | "blocked";
  reason: string;
}

export interface ManagedGoalAgentResponsibilityScheduleState {
  mode: "agentLoop";
  lastGoalTickAt: string;
  lastDecision:
    | {
        kind: "dispatch";
        agentResponsibility: string;
        agentAction: string;
        reason: string;
        at: string;
      }
    | { kind: "idle"; reason: string; at: string }
    | { kind: "blocked"; reason: string; at: string };
  agentResponsibilities: Record<
    string,
    ManagedGoalAgentResponsibilityScheduleStatus
  >;
}

export interface ManagedGoalState {
  version: 1;
  state: ManagedGoalStateValue;
  type: string;
  destination: ManagedGoalDestination;
  agentResponsibilities: string[];
  route: ManagedGoalRouteStep[];
  schedule?: ManagedGoalSchedule;
  preferredRunTime?: ManagedGoalPreferredRunTime;
  stage?: string;
  facts: Record<string, unknown>;
  blockers: string[];
  scheduleMode?: "agentLoop" | string;
  loopTarget?: ManagedLoopTarget;
  saveReport?: boolean;
  scheduleState?: ManagedGoalAgentResponsibilityScheduleState;
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

export function canDeleteManagedGoal(goal: ManagedGoalRecord): boolean {
  return goal.source === "store" || goal.recordType === "instance";
}

export function managedGoalModel(goal: ManagedGoalRecord): ManagedGoalModel {
  if (
    goal.state.scheduleMode === "agentLoop" ||
    goal.state.scheduleMode === "duty-cadence"
  ) {
    return "agentLoop";
  }
  if (LEGACY_ROUTINE_TYPE_IDS.has(goal.state.type)) return "agentLoop";

  const goalType = MANAGED_GOAL_TYPES.find(
    (type) => type.id === goal.state.type,
  );
  if (goalType) return goalType.model;
  if (
    goal.state.route.length > 0 ||
    goal.state.destination.evidence.length > 0
  ) {
    return "agentGoal";
  }

  return "agentLoop";
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
  preferredRunTime?: ManagedGoalPreferredRunTime | null;
  loopTarget?: ManagedLoopTarget;
  saveReport?: boolean;
  agentResponsibilities?: string[];
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export interface SimpleManagedGoalCreateFields {
  id?: string;
  goalType: ManagedGoalTypeId;
  schedule: ManagedGoalSchedule;
  preferredRunTime?: ManagedGoalPreferredRunTime | null;
  prompt: string;
  loopTarget?: ManagedLoopTarget;
  saveReport?: boolean;
  agentResponsibilities?: string[];
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export interface UpdateManagedGoalInput {
  state?: Exclude<ManagedGoalStateValue, "done">;
  pausedReason?: string;
  type?: string;
  outcome?: string;
  schedule?: ManagedGoalSchedule;
  preferredRunTime?: ManagedGoalPreferredRunTime | null;
  loopTarget?: ManagedLoopTarget;
  saveReport?: boolean;
  agentResponsibilities?: string[];
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export function managedGoalPath(goalId: string): string {
  if (!goalId || /[\\/]/.test(goalId) || goalId.includes("..")) {
    throw new Error(`Invalid goalId path: ${JSON.stringify(goalId)}`);
  }
  return `goals/instances/${goalId}/state.json`;
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

function normalizeManagedGoalPreferredRunTime(
  value: ManagedGoalPreferredRunTime | null | undefined,
): ManagedGoalPreferredRunTime | undefined {
  if (!value) return undefined;
  const time = value.time.trim();
  const timezone = value.timezone.trim();
  if (!time || !timezone) return undefined;
  return { time, timezone };
}

function normalizeManagedLoopTarget(
  target: ManagedLoopTarget | undefined,
): ManagedLoopTarget | undefined {
  if (!target) return undefined;
  const id = target.id.trim();
  if (!id) return undefined;
  return { type: target.type, id };
}

function isWebReleaseGoal(goal: Partial<ManagedGoalState>): boolean {
  const templateId =
    typeof goal.templateId === "string" ? goal.templateId.trim() : "";
  const sourceTemplate =
    typeof goal.sourceTemplate === "string" ? goal.sourceTemplate.trim() : "";
  return (
    goal.type === "web-release" ||
    templateId === "web-release" ||
    sourceTemplate === "web-release"
  );
}

function normalizeManagedGoalResponsibility(
  goal: Partial<ManagedGoalState>,
  slug: string,
): string {
  if (isWebReleaseGoal(goal) && slug === "release") {
    return "release-prepare";
  }
  return slug;
}

function cloneRouteStep(step: ManagedGoalRouteStep): ManagedGoalRouteStep {
  return {
    stage: step.stage,
    evidence: step.evidence,
    agentResponsibility: step.agentResponsibility,
    ...(step.agentAction ? { agentAction: step.agentAction } : {}),
    ...(step.saveReport === true ? { saveReport: true } : {}),
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
    ...(fields.preferredRunTime
      ? { preferredRunTime: fields.preferredRunTime }
      : {}),
    outcome: fields.prompt.trim(),
    ...(fields.loopTarget ? { loopTarget: fields.loopTarget } : {}),
    ...(typeof fields.saveReport === "boolean"
      ? { saveReport: fields.saveReport }
      : {}),
    ...(fields.agentResponsibilities
      ? { agentResponsibilities: fields.agentResponsibilities }
      : {}),
    ...(fields.evidence ? { evidence: fields.evidence } : {}),
    ...(fields.route ? { route: fields.route } : {}),
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
      agentResponsibilities: [],
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
  const isRoutine = selectedGoalType?.model === "agentLoop";
  const loopTarget = isRoutine
    ? normalizeManagedLoopTarget(input.loopTarget)
    : undefined;
  const preferredRunTime = isRoutine
    ? normalizeManagedGoalPreferredRunTime(input.preferredRunTime)
    : undefined;
  const evidenceInput = input.evidence ?? selectedGoalType?.evidence ?? [];
  const routeInput = input.route ?? selectedGoalType?.route ?? [];
  const agentResponsibilityInput =
    input.agentResponsibilities !== undefined
      ? input.agentResponsibilities
      : loopTarget?.type === "agentResponsibility"
        ? [loopTarget.id]
        : isRoutine
          ? []
          : (selectedGoalType?.agentResponsibilities ?? []);
  const evidence = evidenceInput.map(normalizeEvidenceKey).filter(Boolean);
  const evidenceSet = new Set(evidence);
  const route = routeInput
    .map(cloneRouteStep)
    .map((step) => ({
      stage: step.stage.trim(),
      evidence: normalizeEvidenceKey(step.evidence),
      agentResponsibility: step.agentResponsibility.trim(),
      ...(step.agentAction?.trim()
        ? { agentAction: step.agentAction.trim() }
        : {}),
      ...(step.saveReport === true ? { saveReport: true } : {}),
      ...(step.args ? { args: step.args } : {}),
    }))
    .filter(
      (step) =>
        step.stage &&
        step.evidence &&
        step.agentResponsibility &&
        evidenceSet.has(step.evidence),
    );
  const agentResponsibilities = uniqueStrings([
    ...agentResponsibilityInput,
    ...route.map((step) => step.agentResponsibility),
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
    ...(isRoutine
      ? {
          scheduleMode: "agentLoop" as const,
          ...(preferredRunTime ? { preferredRunTime } : {}),
          ...(loopTarget ? { loopTarget } : {}),
          ...(typeof input.saveReport === "boolean"
            ? { saveReport: input.saveReport }
            : {}),
        }
      : {}),
    agentResponsibilities,
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
    Array.isArray(goal.agentResponsibilities) &&
    Array.isArray(goal.route) &&
    !!goal.facts &&
    typeof goal.facts === "object" &&
    !Array.isArray(goal.facts) &&
    Array.isArray(goal.blockers)
  );
}

export function normalizeManagedGoalState(
  value: unknown,
): ManagedGoalState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const goal = value as Partial<ManagedGoalState>;
  const destination = goal.destination as Partial<ManagedGoalDestination>;
  if (
    goal.version !== 1 ||
    typeof goal.state !== "string" ||
    typeof goal.type !== "string" ||
    !destination ||
    typeof destination !== "object" ||
    !Array.isArray(destination.evidence) ||
    !Array.isArray(goal.route) ||
    !goal.facts ||
    typeof goal.facts !== "object" ||
    Array.isArray(goal.facts) ||
    !Array.isArray(goal.blockers)
  ) {
    return null;
  }

  const route = goal.route
    .map((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      const legacyStep = step as ManagedGoalRouteStep & {
        duty?: unknown;
        executable?: unknown;
      };
      const stage =
        typeof legacyStep.stage === "string" ? legacyStep.stage : "";
      const evidence =
        typeof legacyStep.evidence === "string" ? legacyStep.evidence : "";
      const rawAgentResponsibility =
        typeof legacyStep.agentResponsibility === "string"
          ? legacyStep.agentResponsibility
          : typeof legacyStep.duty === "string"
            ? legacyStep.duty
            : "";
      const agentAction =
        typeof legacyStep.agentAction === "string"
          ? legacyStep.agentAction
          : typeof legacyStep.executable === "string"
            ? legacyStep.executable
            : "";

      if (!stage || !evidence || !rawAgentResponsibility) return null;
      const agentResponsibility = normalizeManagedGoalResponsibility(
        goal,
        rawAgentResponsibility,
      );
      return {
        stage,
        evidence,
        agentResponsibility,
        ...(agentAction ? { agentAction } : {}),
        ...(legacyStep.saveReport === true ? { saveReport: true } : {}),
        ...(legacyStep.args && typeof legacyStep.args === "object"
          ? { args: legacyStep.args as Record<string, unknown> }
          : {}),
      };
    })
    .filter((step): step is ManagedGoalRouteStep => !!step);

  const legacyDuties = (goal as { duties?: unknown }).duties;
  const agentResponsibilities = uniqueStrings(
    [
      ...(Array.isArray(goal.agentResponsibilities)
        ? goal.agentResponsibilities.filter(
            (responsibility): responsibility is string =>
              typeof responsibility === "string",
          )
        : []),
      ...(Array.isArray(legacyDuties)
        ? legacyDuties.filter(
            (responsibility): responsibility is string =>
              typeof responsibility === "string",
          )
        : []),
      ...route.map((step) => step.agentResponsibility),
    ].map((responsibility) =>
      normalizeManagedGoalResponsibility(goal, responsibility),
    ),
  );

  return {
    ...goal,
    destination: {
      ...destination,
      outcome:
        typeof destination.outcome === "string" ? destination.outcome : "",
      evidence: destination.evidence,
    },
    agentResponsibilities,
    route,
    facts: goal.facts,
    blockers: goal.blockers,
  } as ManagedGoalState;
}
