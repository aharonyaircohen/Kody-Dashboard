/**
 * @fileType utility
 * @domain kody
 * @pattern workflow-definitions
 * @ai-summary Company workflow definitions stored as ordered capability queues
 *   under `<statePath>/workflows/<id>/workflow.json`.
 */

export interface WorkflowDefinition {
  version: 1;
  name: string;
  capabilities: string[];
  runWithoutApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinitionRecord {
  id: string;
  path: string;
  workflow: WorkflowDefinition;
  updatedAt?: string;
  source?: "local" | "store";
  readOnly?: boolean;
  /** True when this workflow can be dispatched directly by kody.yml. */
  runnable?: boolean;
  htmlUrl?: string | null;
}

export interface CreateWorkflowDefinitionInput {
  id?: string;
  name: string;
  capabilities: string[];
  runWithoutApproval?: boolean;
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  capabilities?: string[];
  runWithoutApproval?: boolean;
}

const WORKFLOW_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function isWorkflowDefinitionId(value: string): boolean {
  return WORKFLOW_ID_PATTERN.test(value);
}

export function slugifyWorkflowDefinitionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/[-_]+$/g, "");
}

export function workflowDefinitionPath(id: string): string {
  if (!isWorkflowDefinitionId(id)) {
    throw new Error(`Invalid workflow id "${id}"`);
  }
  return `workflows/${id}/workflow.json`;
}

export function normalizeWorkflowCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const capabilities: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!CAPABILITY_ID_PATTERN.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    capabilities.push(slug);
  }
  return capabilities;
}

function normalizeWorkflowStepCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const capabilities: string[] = [];
  for (const item of value) {
    const slug =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && !Array.isArray(item)
          ? typeof (item as { capability?: unknown }).capability === "string"
            ? (item as { capability: string }).capability.trim()
            : ""
          : "";
    if (!CAPABILITY_ID_PATTERN.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    capabilities.push(slug);
  }
  return capabilities;
}

export function normalizeWorkflowDefinition(
  value: unknown,
): WorkflowDefinition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const capabilities = [
    ...normalizeWorkflowCapabilities(raw.capabilities),
    ...normalizeWorkflowStepCapabilities(raw.steps),
  ];
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim()
      ? raw.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : createdAt;

  if (!name || capabilities.length === 0) return null;
  return {
    version: 1,
    name,
    capabilities,
    ...(raw.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
    createdAt,
    updatedAt,
  };
}

export function buildWorkflowDefinition(
  input: CreateWorkflowDefinitionInput,
  existing?: WorkflowDefinition,
): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    version: 1,
    name: input.name.trim(),
    capabilities: normalizeWorkflowCapabilities(input.capabilities),
    ...(input.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function mergeWorkflowDefinition(
  existing: WorkflowDefinition,
  input: UpdateWorkflowDefinitionInput,
): WorkflowDefinition {
  return buildWorkflowDefinition(
    {
      name: input.name ?? existing.name,
      capabilities: input.capabilities ?? existing.capabilities,
      runWithoutApproval:
        input.runWithoutApproval ?? existing.runWithoutApproval,
    },
    existing,
  );
}
