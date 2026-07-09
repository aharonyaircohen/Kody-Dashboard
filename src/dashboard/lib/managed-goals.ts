/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Engine managed goal contract. These goals live as one todo list
 * per goal at `<statePath>/todos/<id>.json`.
 */

import { slugifyTitle } from "./slug";

export type ManagedGoalStateValue = "inactive" | "active" | "paused" | "done";
export type ManagedGoalSchedule = "manual" | "15m" | "1h" | "1d" | "7d" | "30d";
export interface ManagedGoalPreferredRunTime {
  time: string;
  timezone: string;
}
export type ManagedLoopTargetType = "capability" | "goal" | "workflow";
export interface ManagedLoopTarget {
  type: ManagedLoopTargetType;
  id: string;
}
export interface ManagedGoalWorkflowRef {
  id: string;
  source?: "local" | "store";
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
  capabilities: string[];
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
    capabilities: ["plan", "fix", "review"],
    route: [
      {
        stage: "plan",
        evidence: "planReady",
        capability: "plan",
      },
      {
        stage: "implement",
        evidence: "changeImplemented",
        capability: "fix",
      },
      {
        stage: "review",
        evidence: "changeVerified",
        capability: "review",
      },
    ],
  },
  {
    id: "agentLoop",
    model: "agentLoop",
    label: "AgentLoop",
    description:
      "Wake a goal, workflow, or capability on schedule and surface health or drift.",
    bestFor:
      "Ongoing health, maintenance, QA sweeps, monitoring, and repo hygiene.",
    systemSummary:
      "Kody wakes the selected target on schedule and records findings.",
    promptPlaceholder: "Example: Keep codebase healthy and report drift.",
    evidence: [],
    capabilities: [
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
    capabilities: [
      "release-prepare",
      "task-leader",
      "vercel-production-deploy",
    ],
    route: [
      {
        stage: "release",
        evidence: "releasePrExists",
        capability: "release-prepare",
        args: {
          issue: { fact: "issue" },
          goal: "web-release",
        },
      },
      {
        stage: "merge",
        evidence: "mainMerged",
        capability: "task-leader",
        args: {
          issue: { fact: "issue" },
        },
      },
      {
        stage: "publish",
        evidence: "productionDeployed",
        capability: "vercel-production-deploy",
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
    capabilities: ["task-verifier"],
    route: [
      {
        stage: "verify",
        evidence: "checklistComplete",
        capability: "task-verifier",
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
  capability: string;
  saveReport?: boolean;
  args?: Record<string, unknown>;
}

export interface ManagedGoalCapabilityScheduleStatus {
  slug: string;
  title?: string;
  cadence?: string;
  lastFiredAt?: string;
  nextEligibleAt?: string;
  state: "due" | "waiting" | "manual" | "disabled" | "blocked";
  reason: string;
}

export interface ManagedGoalCapabilityScheduleState {
  mode: "agentLoop";
  lastGoalTickAt: string;
  lastDecision:
    | {
        kind: "dispatch";
        capability?: string;
        targetType?: "goal" | "workflow";
        targetId?: string;
        action?: string;
        workflow?: string;
        implementation?: string;
        reason: string;
        at: string;
      }
    | { kind: "idle"; reason: string; at: string }
    | { kind: "blocked"; reason: string; at: string };
  capabilities: Record<string, ManagedGoalCapabilityScheduleStatus>;
}

export interface ManagedGoalState {
  version: 1;
  state: ManagedGoalStateValue;
  type: string;
  destination: ManagedGoalDestination;
  capabilities: string[];
  route: ManagedGoalRouteStep[];
  runWithoutApproval?: boolean;
  schedule?: ManagedGoalSchedule;
  preferredRunTime?: ManagedGoalPreferredRunTime;
  stage?: string;
  facts: Record<string, unknown>;
  blockers: string[];
  scheduleMode?: "agentLoop" | string;
  loopTarget?: ManagedLoopTarget;
  saveReport?: boolean;
  scheduleState?: ManagedGoalCapabilityScheduleState;
  workflowRef?: ManagedGoalWorkflowRef;
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

export function mergeManagedGoalStateWithTemplate(
  state: ManagedGoalState,
  template: ManagedGoalState,
): ManagedGoalState {
  const merged = normalizeManagedGoalState({
    ...state,
    type: template.type,
    destination: template.destination,
    capabilities: template.capabilities,
    route: template.route,
    schedule: template.schedule,
    scheduleMode: template.scheduleMode,
    preferredRunTime: template.preferredRunTime,
    loopTarget: template.loopTarget,
    workflowRef: template.workflowRef ?? state.workflowRef,
    saveReport: template.saveReport,
    facts: {
      ...template.facts,
      ...state.facts,
    },
    state: state.state,
    blockers: state.blockers,
  });
  return merged ?? state;
}

export function canDeleteManagedGoal(goal: ManagedGoalRecord): boolean {
  return goal.source === "store" || goal.recordType === "instance";
}

export function managedGoalModel(goal: ManagedGoalRecord): ManagedGoalModel {
  if (
    goal.state.scheduleMode === "agentLoop" ||
    goal.state.scheduleMode === "capability-cadence"
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
  workflowRef?: ManagedGoalWorkflowRef;
  saveReport?: boolean;
  runWithoutApproval?: boolean;
  capabilities?: string[];
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
  workflowRef?: ManagedGoalWorkflowRef;
  saveReport?: boolean;
  runWithoutApproval?: boolean;
  capabilities?: string[];
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
  workflowRef?: ManagedGoalWorkflowRef | null;
  saveReport?: boolean;
  runWithoutApproval?: boolean;
  capabilities?: string[];
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export function managedGoalPath(goalId: string): string {
  if (!goalId || /[\\/]/.test(goalId) || goalId.includes("..")) {
    throw new Error(`Invalid goalId path: ${JSON.stringify(goalId)}`);
  }
  return `todos/${goalId}.json`;
}

export function slugifyManagedGoalId(value: string): string {
  return slugifyTitle(value, { allowUnderscore: false });
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

function normalizeManagedGoalWorkflowRef(
  ref: ManagedGoalWorkflowRef | null | undefined,
): ManagedGoalWorkflowRef | undefined {
  if (!ref) return undefined;
  const id = ref.id.trim();
  if (!id) return undefined;
  return {
    id,
    ...(ref.source === "local" || ref.source === "store"
      ? { source: ref.source }
      : {}),
  };
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

function normalizeManagedGoalCapability(
  goal: Partial<ManagedGoalState>,
  slug: string,
): string {
  if (isWebReleaseGoal(goal) && slug === "release") {
    return "release-prepare";
  }
  return slug;
}

function normalizeManagedGoalScheduleState(
  value: unknown,
): ManagedGoalCapabilityScheduleState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as {
    mode?: unknown;
    lastGoalTickAt?: unknown;
    lastDecision?: unknown;
    capabilities?: unknown;
  };
  if (raw.mode !== "agentLoop" || typeof raw.lastGoalTickAt !== "string") {
    return undefined;
  }

  const rawCapabilities = raw.capabilities;
  const capabilities: Record<string, ManagedGoalCapabilityScheduleStatus> = {};
  if (rawCapabilities && typeof rawCapabilities === "object") {
    for (const [slug, status] of Object.entries(rawCapabilities)) {
      if (!status || typeof status !== "object" || Array.isArray(status)) {
        continue;
      }
      const item = status as Partial<ManagedGoalCapabilityScheduleStatus>;
      capabilities[slug] = {
        slug: typeof item.slug === "string" ? item.slug : slug,
        ...(typeof item.title === "string" ? { title: item.title } : {}),
        ...(typeof item.cadence === "string" ? { cadence: item.cadence } : {}),
        ...(typeof item.lastFiredAt === "string"
          ? { lastFiredAt: item.lastFiredAt }
          : {}),
        ...(typeof item.nextEligibleAt === "string"
          ? { nextEligibleAt: item.nextEligibleAt }
          : {}),
        state: item.state ?? "waiting",
        reason: typeof item.reason === "string" ? item.reason : "",
      };
    }
  }

  const rawDecision =
    raw.lastDecision && typeof raw.lastDecision === "object"
      ? (raw.lastDecision as {
          kind?: unknown;
          capability?: unknown;
          targetType?: unknown;
          targetId?: unknown;
          action?: unknown;
          workflow?: unknown;
          implementation?: unknown;
          reason?: unknown;
          at?: unknown;
        })
      : null;
  let lastDecision: ManagedGoalCapabilityScheduleState["lastDecision"] = {
    kind: "idle",
    reason: "",
    at: raw.lastGoalTickAt,
  };
  if (rawDecision?.kind === "dispatch") {
    const fallbackCapability =
      typeof rawDecision.capability === "string"
        ? rawDecision.capability
        : typeof rawDecision.targetId === "string"
          ? rawDecision.targetId
          : typeof rawDecision.action === "string"
            ? rawDecision.action
            : typeof rawDecision.workflow === "string"
              ? rawDecision.workflow
              : typeof rawDecision.implementation === "string"
                ? rawDecision.implementation
                : typeof rawDecision.implementation === "string"
                  ? rawDecision.implementation
                  : undefined;
    lastDecision = {
      kind: "dispatch",
      ...(fallbackCapability ? { capability: fallbackCapability } : {}),
      ...(rawDecision.targetType === "goal" ||
      rawDecision.targetType === "workflow"
        ? { targetType: rawDecision.targetType }
        : {}),
      ...(typeof rawDecision.targetId === "string"
        ? { targetId: rawDecision.targetId }
        : {}),
      ...(typeof rawDecision.action === "string"
        ? { action: rawDecision.action }
        : {}),
      ...(typeof rawDecision.workflow === "string"
        ? { workflow: rawDecision.workflow }
        : {}),
      ...(typeof rawDecision.implementation === "string"
        ? { implementation: rawDecision.implementation }
        : typeof rawDecision.implementation === "string"
          ? { implementation: rawDecision.implementation }
          : {}),
      ...(typeof rawDecision.implementation === "string"
        ? { implementation: rawDecision.implementation }
        : {}),
      reason: typeof rawDecision.reason === "string" ? rawDecision.reason : "",
      at: typeof rawDecision.at === "string" ? rawDecision.at : "",
    };
  } else if (rawDecision?.kind === "idle" || rawDecision?.kind === "blocked") {
    lastDecision = {
      kind: rawDecision.kind,
      reason: typeof rawDecision.reason === "string" ? rawDecision.reason : "",
      at: typeof rawDecision.at === "string" ? rawDecision.at : "",
    };
  }

  return {
    mode: "agentLoop",
    lastGoalTickAt: raw.lastGoalTickAt,
    lastDecision,
    capabilities,
  };
}

function cloneRouteStep(step: ManagedGoalRouteStep): ManagedGoalRouteStep {
  return {
    stage: step.stage,
    evidence: step.evidence,
    capability: step.capability,
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
    ...(fields.workflowRef ? { workflowRef: fields.workflowRef } : {}),
    ...(typeof fields.saveReport === "boolean"
      ? { saveReport: fields.saveReport }
      : {}),
    ...(fields.capabilities ? { capabilities: fields.capabilities } : {}),
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
      ...(input.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
      capabilities: [],
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
  const workflowRef = !isRoutine
    ? normalizeManagedGoalWorkflowRef(input.workflowRef)
    : undefined;
  const preferredRunTime = isRoutine
    ? normalizeManagedGoalPreferredRunTime(input.preferredRunTime)
    : undefined;
  const evidenceInput = input.evidence ?? selectedGoalType?.evidence ?? [];
  const routeInput = input.route ?? selectedGoalType?.route ?? [];
  const capabilityInput =
    input.capabilities !== undefined
      ? input.capabilities
      : workflowRef
        ? []
        : loopTarget?.type === "capability"
          ? [loopTarget.id]
          : isRoutine
            ? []
            : (selectedGoalType?.capabilities ?? []);
  const evidence = evidenceInput.map(normalizeEvidenceKey).filter(Boolean);
  const evidenceSet = new Set(evidence);
  const route = routeInput
    .map(cloneRouteStep)
    .map((step) => ({
      stage: step.stage.trim(),
      evidence: normalizeEvidenceKey(step.evidence),
      capability: step.capability.trim(),
      ...(step.saveReport === true ? { saveReport: true } : {}),
      ...(step.args ? { args: step.args } : {}),
    }))
    .filter(
      (step) =>
        step.stage &&
        step.evidence &&
        step.capability &&
        evidenceSet.has(step.evidence),
    );
  const capabilities = uniqueStrings([
    ...capabilityInput,
    ...route.map((step) => step.capability),
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
    ...(input.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
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
    capabilities,
    route,
    stage: route[0]?.stage,
    facts: selectedGoalType ? { goalType: selectedGoalType.id } : {},
    ...(workflowRef ? { workflowRef } : {}),
    blockers: [],
  };
}

export function isManagedGoalState(value: unknown): value is ManagedGoalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const goal = value as Partial<ManagedGoalState>;
  const legacy = value as { capabilities?: unknown };
  return (
    goal.version === 1 &&
    typeof goal.state === "string" &&
    typeof goal.type === "string" &&
    !!goal.destination &&
    typeof goal.destination === "object" &&
    Array.isArray(
      (goal.destination as Partial<ManagedGoalDestination>).evidence,
    ) &&
    (Array.isArray(goal.capabilities) || Array.isArray(legacy.capabilities)) &&
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
        capability?: unknown;
        implementation?: unknown;
      };
      const stage =
        typeof legacyStep.stage === "string" ? legacyStep.stage : "";
      const evidence =
        typeof legacyStep.evidence === "string" ? legacyStep.evidence : "";
      const rawCapability =
        typeof legacyStep.capability === "string"
          ? legacyStep.capability
          : typeof legacyStep.implementation === "string"
            ? legacyStep.implementation
            : "";

      if (!stage || !evidence || !rawCapability) return null;
      const capability = normalizeManagedGoalCapability(goal, rawCapability);
      return {
        stage,
        evidence,
        capability,
        ...(legacyStep.saveReport === true ? { saveReport: true } : {}),
        ...(legacyStep.args && typeof legacyStep.args === "object"
          ? { args: legacyStep.args as Record<string, unknown> }
          : {}),
      };
    })
    .filter((step): step is ManagedGoalRouteStep => !!step);

  const scheduleState = normalizeManagedGoalScheduleState(
    (goal as { scheduleState?: unknown }).scheduleState,
  );
  const capabilities = uniqueStrings(
    [
      ...(Array.isArray(goal.capabilities)
        ? goal.capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string",
          )
        : []),
      ...route.map((step) => step.capability),
    ].map((capability) => normalizeManagedGoalCapability(goal, capability)),
  );

  return {
    ...goal,
    destination: {
      ...destination,
      outcome:
        typeof destination.outcome === "string" ? destination.outcome : "",
      evidence: destination.evidence,
    },
    capabilities,
    route,
    ...(goal.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
    ...(scheduleState ? { scheduleState } : {}),
    facts: goal.facts,
    blockers: goal.blockers,
  } as ManagedGoalState;
}
