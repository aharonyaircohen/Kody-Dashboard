/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Engine managed goal contract. These goals live as one JSON file
 *   per goal at `kody-state:.kody/goals/instances/<id>/state.json`.
 */

export type ManagedGoalStateValue = "inactive" | "active" | "paused" | "done";
export type ManagedGoalSchedule = "manual" | "1h" | "1d" | "7d" | "30d";

export const SIMPLE_MANAGED_GOAL_TEMPLATE = "simple";
export const SIMPLE_MANAGED_GOAL_EVIDENCE = "labelledTasksComplete";

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
  [extraField: string]: unknown;
}

export interface ManagedGoalRecord {
  id: string;
  path: string;
  state: ManagedGoalState;
  source?: "local" | "store";
  recordType?: "instance" | "template";
  updatedAt?: string;
}

export interface CreateManagedGoalInput {
  id?: string;
  templateId?: string;
  type: string;
  outcome: string;
  schedule?: ManagedGoalSchedule;
  evidence?: string[];
  route?: ManagedGoalRouteStep[];
}

export interface UpdateManagedGoalInput {
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

export function isManagedGoalState(value: unknown): value is ManagedGoalState {
  if (!value || typeof value !== "object") return false;
  const goal = value as Partial<ManagedGoalState>;
  return (
    goal.version === 1 &&
    typeof goal.state === "string" &&
    typeof goal.type === "string" &&
    !!goal.destination &&
    typeof goal.destination.outcome === "string" &&
    Array.isArray(goal.destination.evidence) &&
    Array.isArray(goal.duties) &&
    Array.isArray(goal.route) &&
    !!goal.facts &&
    typeof goal.facts === "object" &&
    Array.isArray(goal.blockers)
  );
}

export function buildManagedGoalState(
  input: CreateManagedGoalInput,
): ManagedGoalState {
  if (
    input.templateId === SIMPLE_MANAGED_GOAL_TEMPLATE ||
    input.type === SIMPLE_MANAGED_GOAL_TEMPLATE
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
        simpleAttachedTaskCount: 0,
        simpleOpenTaskCount: 0,
        [SIMPLE_MANAGED_GOAL_EVIDENCE]: false,
      },
      blockers: [],
    };
  }

  const evidence = (input.evidence ?? []).map(normalizeEvidenceKey).filter(Boolean);
  const evidenceSet = new Set(evidence);
  const route = (input.route ?? [])
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
  const duties = Array.from(new Set(route.map((step) => step.duty))).sort();

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
    facts: {},
    blockers: [],
  };
}
