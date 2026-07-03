import type { ManagedGoalRecord, ManagedLoopTarget } from "../managed-goals";
import { managedGoalModel } from "../managed-goals";
import type { WorkflowDefinitionRecord } from "../workflow-definitions";
import type { TrustCapabilityView, TrustOp } from "./trust-state";

export type RunMode = "auto" | "manual";

export function uniqueCapabilitySlugs(slugs: readonly string[]): string[] {
  return Array.from(new Set(slugs.map((slug) => slug.trim()).filter(Boolean)));
}

export function runModeForCapabilities(
  groups: readonly Pick<TrustCapabilityView, "capability" | "mode">[],
  slugs: readonly string[],
): RunMode {
  const uniqueSlugs = uniqueCapabilitySlugs(slugs);
  if (uniqueSlugs.length === 0) return "manual";
  const autoSlugs = new Set(
    groups
      .filter((group) => group.mode === "auto")
      .map((group) => group.capability),
  );
  return uniqueSlugs.every((slug) => autoSlugs.has(slug)) ? "auto" : "manual";
}

export function trustOpForRunMode(mode: RunMode): TrustOp {
  return mode === "auto" ? "graduate" : "degrade";
}

export async function applyRunModeToCapabilities(
  setTrust: (input: { capability: string; op: TrustOp }) => Promise<void>,
  slugs: readonly string[],
  mode: RunMode,
): Promise<void> {
  const uniqueSlugs = uniqueCapabilitySlugs(slugs);
  if (uniqueSlugs.length === 0) return;
  const op = trustOpForRunMode(mode);
  await Promise.all(
    uniqueSlugs.map((capability) => setTrust({ capability, op })),
  );
}

export function workflowCapabilitySlugs(
  workflow: WorkflowDefinitionRecord,
): string[] {
  return uniqueCapabilitySlugs(workflow.workflow.capabilities);
}

export function managedModelCapabilitySlugs(
  goal: ManagedGoalRecord,
  goals: readonly ManagedGoalRecord[],
  workflows: readonly WorkflowDefinitionRecord[],
): string[] {
  return managedModelCapabilitySlugsInner(goal, goals, workflows, new Set());
}

function managedModelCapabilitySlugsInner(
  goal: ManagedGoalRecord,
  goals: readonly ManagedGoalRecord[],
  workflows: readonly WorkflowDefinitionRecord[],
  seen: Set<string>,
): string[] {
  if (seen.has(goal.id)) return [];
  seen.add(goal.id);

  const target = goalLoopTarget(goal);
  if (managedGoalModel(goal) === "agentLoop" && target) {
    const targetSlugs = targetCapabilitySlugs(target, goals, workflows, seen);
    return targetSlugs.length
      ? targetSlugs
      : ownManagedModelCapabilitySlugs(goal);
  }

  return ownManagedModelCapabilitySlugs(goal);
}

function ownManagedModelCapabilitySlugs(goal: ManagedGoalRecord): string[] {
  return uniqueCapabilitySlugs([
    ...goal.state.capabilities,
    ...goal.state.route.map((step) => step.capability),
    ...Object.keys(goal.state.scheduleState?.capabilities ?? {}),
  ]);
}

function targetCapabilitySlugs(
  target: ManagedLoopTarget,
  goals: readonly ManagedGoalRecord[],
  workflows: readonly WorkflowDefinitionRecord[],
  seen: Set<string>,
): string[] {
  if (target.type === "capability") return uniqueCapabilitySlugs([target.id]);
  if (target.type === "workflow") {
    const workflow = workflows.find((item) => item.id === target.id);
    return workflow ? workflowCapabilitySlugs(workflow) : [];
  }
  const goal = goals.find((item) => item.id === target.id);
  return goal
    ? managedModelCapabilitySlugsInner(goal, goals, workflows, seen)
    : [];
}

function goalLoopTarget(goal: ManagedGoalRecord): ManagedLoopTarget | null {
  const target = goal.state.loopTarget;
  if (isManagedLoopTarget(target)) {
    return { type: target.type, id: target.id.trim() };
  }
  const firstCapability = goal.state.capabilities[0]?.trim();
  return firstCapability ? { type: "capability", id: firstCapability } : null;
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
