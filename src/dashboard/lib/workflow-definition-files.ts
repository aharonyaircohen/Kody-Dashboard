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
  listCompanyStoreDirectorySafe,
  readCompanyStoreText,
} from "./company-store/assets";
import {
  isWorkflowDefinitionId,
  normalizeWorkflowDefinition,
  workflowDefinitionPath,
  type WorkflowDefinition,
  type WorkflowDefinitionRecord,
} from "./workflow-definitions";

interface ContentFile {
  type?: string;
  name?: string;
}

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
  const path = `.kody/workflows/${id}/workflow.json`;
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
  const dirs = await listCompanyStoreDirectorySafe(octokit, ".kody/workflows");
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
