/**
 * @fileType utility
 * @domain kody
 * @pattern workflow-definition-files
 * @ai-summary Read, write, list, and delete workflow definition files in the
 *   configured Kody state repo.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "./github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  writeStateText,
} from "./state-repo";
import {
  buildCompanyStoreHtmlUrl,
  companyStoreAssetPath,
  listCompanyStoreDirectorySafe,
  readCompanyStoreText,
} from "./company-store/assets";
import {
  isWorkflowDefinitionId,
  normalizeWorkflowCapabilities,
  normalizeWorkflowDefinition,
  workflowDefinitionPath,
  type WorkflowDefinition,
  type WorkflowDefinitionRecord,
} from "./workflow-definitions";
import {
  listStoreCapabilityFiles,
  type CapabilitySummary,
} from "./capabilities/files";

interface ContentFile {
  type?: string;
  name?: string;
}

const STORE_CAPABILITY_WORKFLOW_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export async function readWorkflowDefinitionFile(
  id: string,
  octokit: Octokit = getOctokit(),
  owner = getOwner(),
  repo = getRepo(),
): Promise<{
  workflow: WorkflowDefinition;
  sha: string;
  path: string;
  htmlUrl?: string;
} | null> {
  const path = workflowDefinitionPath(id);
  const file = await readStateText(octokit, owner, repo, path, {
    headers: { "If-None-Match": "" },
  });
  if (!file) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return null;
  }
  const workflow = normalizeWorkflowDefinition(parsed);
  if (!workflow) return null;
  return { workflow, sha: file.sha, path, htmlUrl: file.htmlUrl };
}

async function listWorkflowDefinitionDirs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ContentFile[]> {
  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    "workflows",
    { headers: { "If-None-Match": "" } },
  );
  return entries.filter((item) => item.type === "dir");
}

export async function listWorkflowDefinitionFiles(
  octokit: Octokit = getOctokit(),
  owner = getOwner(),
  repo = getRepo(),
): Promise<WorkflowDefinitionRecord[]> {
  const dirs = await listWorkflowDefinitionDirs(octokit, owner, repo);
  const workflows: WorkflowDefinitionRecord[] = [];

  for (const dir of dirs) {
    if (!dir.name) continue;
    const file = await readWorkflowDefinitionFile(
      dir.name,
      octokit,
      owner,
      repo,
    );
    if (!file) continue;
    workflows.push({
      id: dir.name,
      path: file.path,
      workflow: file.workflow,
      updatedAt: file.workflow.updatedAt,
      source: "local",
      readOnly: false,
      htmlUrl: file.htmlUrl ?? null,
    });
  }

  return workflows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readCompanyStoreWorkflowDefinitionFile(
  id: string,
  octokit: Octokit = getOctokit(),
): Promise<WorkflowDefinitionRecord | null> {
  if (!isWorkflowDefinitionId(id)) return null;
  const path = await companyStoreAssetPath(
    octokit,
    "workflows",
    id,
    "workflow.json",
  );
  const raw = await readCompanyStoreText(octokit, path);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const workflow = normalizeWorkflowDefinition(parsed);
  if (!workflow) return null;
  return {
    id,
    path,
    workflow,
    updatedAt: workflow.updatedAt,
    source: "store",
    readOnly: true,
    htmlUrl: buildCompanyStoreHtmlUrl("workflows", id),
  };
}

export async function listCompanyStoreWorkflowDefinitionFiles(
  octokit: Octokit = getOctokit(),
): Promise<WorkflowDefinitionRecord[]> {
  const root = await companyStoreAssetPath(octokit, "workflows");
  const dirs = await listCompanyStoreDirectorySafe(octokit, root);
  const workflows = await Promise.all(
    dirs
      .filter(
        (entry) => entry.type === "dir" && isWorkflowDefinitionId(entry.name),
      )
      .map((entry) =>
        readCompanyStoreWorkflowDefinitionFile(entry.name, octokit),
      ),
  );
  return workflows
    .filter((workflow): workflow is WorkflowDefinitionRecord => !!workflow)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function workflowRecordFromCapabilitySummary(
  capability: CapabilitySummary,
): WorkflowDefinitionRecord | null {
  const workflowSteps = normalizeWorkflowCapabilities(
    capability.workflowSteps ?? [],
  );
  if (!capability.isWorkflow || workflowSteps.length === 0) return null;
  if (!isWorkflowDefinitionId(capability.slug)) return null;

  const updatedAt = capability.updatedAt ?? STORE_CAPABILITY_WORKFLOW_TIMESTAMP;
  return {
    id: capability.slug,
    path: `.kody/capabilities/${capability.slug}/profile.json`,
    workflow: {
      version: 1,
      name: capability.slug,
      capabilities: workflowSteps,
      createdAt: updatedAt,
      updatedAt,
    },
    updatedAt,
    source: "store",
    readOnly: true,
    runnable: true,
    htmlUrl: capability.htmlUrl,
  };
}

export async function listCompanyStoreCapabilityWorkflowDefinitionFiles(
  octokit: Octokit = getOctokit(),
  activeSlugs?: Iterable<string>,
): Promise<WorkflowDefinitionRecord[]> {
  const active = activeSlugs ? new Set(activeSlugs) : null;
  const capabilities = await listStoreCapabilityFiles(octokit);
  return capabilities
    .filter((capability) => !active || active.has(capability.slug))
    .map(workflowRecordFromCapabilitySummary)
    .filter((workflow): workflow is WorkflowDefinitionRecord => !!workflow)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readCompanyStoreCapabilityWorkflowDefinitionFile(
  id: string,
  octokit: Octokit = getOctokit(),
): Promise<WorkflowDefinitionRecord | null> {
  if (!isWorkflowDefinitionId(id)) return null;
  const workflows = await listCompanyStoreCapabilityWorkflowDefinitionFiles(
    octokit,
    [id],
  );
  return workflows[0] ?? null;
}

export async function writeWorkflowDefinitionFile({
  octokit,
  owner = getOwner(),
  repo = getRepo(),
  id,
  workflow,
  sha,
  message,
}: {
  octokit: Octokit;
  owner?: string;
  repo?: string;
  id: string;
  workflow: WorkflowDefinition;
  sha?: string;
  message?: string;
}): Promise<void> {
  await writeStateText({
    octokit,
    owner,
    repo,
    path: workflowDefinitionPath(id),
    message: message ?? `chore(workflows): update workflow ${id}`,
    content: JSON.stringify(workflow, null, 2),
    sha,
  });
}

export async function deleteWorkflowDefinitionFile({
  octokit,
  owner = getOwner(),
  repo = getRepo(),
  id,
  sha,
  message,
}: {
  octokit: Octokit;
  owner?: string;
  repo?: string;
  id: string;
  sha: string;
  message?: string;
}): Promise<void> {
  await deleteStateFile({
    octokit,
    owner,
    repo,
    path: workflowDefinitionPath(id),
    message: message ?? `chore(workflows): delete workflow ${id}`,
    sha,
  });
}
