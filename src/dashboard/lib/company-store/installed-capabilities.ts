/**
 * @fileType utility
 * @domain company-store
 * @pattern installed-capability-resolution
 * @ai-summary Resolves the capabilities installed for a repo from direct
 *   config, active Store goals, and Store workflows referenced by those goals.
 */

import type { Octokit } from "@octokit/rest";
import type { ActiveGoalConfigEntry } from "../engine/config";
import { listCompanyStoreGoalTemplateFiles } from "../managed-goals-files";
import type { ManagedGoalState } from "../managed-goals";
import { listCompanyStoreWorkflowDefinitionFiles } from "../workflow-definition-files";
import type { WorkflowDefinitionRecord } from "../workflow-definitions";

export interface InstalledCapabilityConfig {
  company?: {
    activeCapabilities?: unknown;
    activeGoals?: unknown;
    activeWorkflows?: unknown;
  };
}

function activeGoalSlug(entry: ActiveGoalConfigEntry): string {
  return typeof entry === "string" ? entry : entry.template;
}

function stringSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function activeGoalSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is ActiveGoalConfigEntry =>
        typeof entry === "string" ||
        (Boolean(entry) &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          typeof (entry as { template?: unknown }).template === "string"),
    )
    .map(activeGoalSlug);
}

export function capabilitySlugsFromGoalState(
  state: ManagedGoalState,
): string[] {
  const slugs = new Set<string>();
  for (const slug of state.capabilities) slugs.add(slug);
  for (const step of state.route) slugs.add(step.capability);
  if (state.loopTarget?.type === "capability") slugs.add(state.loopTarget.id);
  return [...slugs];
}

export function workflowSlugsFromGoalState(state: ManagedGoalState): string[] {
  const slugs = new Set<string>();
  if (state.workflowRef?.id) slugs.add(state.workflowRef.id);
  if (state.loopTarget?.type === "workflow") slugs.add(state.loopTarget.id);
  return [...slugs];
}

function addWorkflowCapabilities(
  installed: Set<string>,
  workflows: WorkflowDefinitionRecord[],
  workflowIds: Iterable<string>,
): void {
  const active = new Set(workflowIds);
  for (const workflow of workflows) {
    if (!active.has(workflow.id)) continue;
    for (const capability of workflow.workflow.capabilities) {
      installed.add(capability);
    }
  }
}

export async function resolveInstalledCapabilitySlugs(
  octokit: Octokit,
  config: InstalledCapabilityConfig,
): Promise<Set<string>> {
  const company = config.company ?? {};
  const installed = new Set(stringSlugs(company.activeCapabilities));
  const activeGoals = new Set(activeGoalSlugs(company.activeGoals));
  const activeWorkflows = new Set(stringSlugs(company.activeWorkflows));

  const [goals, workflows] = await Promise.all([
    activeGoals.size > 0 ? listCompanyStoreGoalTemplateFiles(octokit) : [],
    activeWorkflows.size > 0 || activeGoals.size > 0
      ? listCompanyStoreWorkflowDefinitionFiles(octokit)
      : [],
  ]);

  for (const goal of goals) {
    if (!activeGoals.has(goal.id)) continue;
    for (const capability of capabilitySlugsFromGoalState(goal.state)) {
      installed.add(capability);
    }
    for (const workflow of workflowSlugsFromGoalState(goal.state)) {
      activeWorkflows.add(workflow);
    }
  }

  addWorkflowCapabilities(installed, workflows, activeWorkflows);
  return installed;
}
