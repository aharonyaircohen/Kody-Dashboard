/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals-files
 * @ai-summary Read and write managed goal state files in the configured Kody state repo.
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
  listCompanyStoreDirectorySafe,
  readCompanyStoreText,
} from "./company-store/assets";
import {
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
  type ManagedGoalState,
} from "./managed-goals";

const GOAL_TEMPLATE_ROOT = ".kody/goals/templates";

interface ContentFile {
  type?: string;
  name?: string;
  path?: string;
  encoding?: string;
  content?: string;
  sha?: string;
}

export async function readManagedGoalFile(
  goalId: string,
  octokit: Octokit = getOctokit(),
  owner = getOwner(),
  repo = getRepo(),
): Promise<{ state: ManagedGoalState; sha: string; path: string } | null> {
  const path = managedGoalPath(goalId);
  const file = await readStateText(octokit, owner, repo, path, {
    headers: { "If-None-Match": "" },
  });
  if (!file) return null;
  const parsed = JSON.parse(file.content) as unknown;
  const state = normalizeManagedGoalState(parsed);
  if (!state) return null;
  return { state, sha: file.sha, path };
}

async function listManagedGoalDirs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ContentFile[]> {
  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    "goals/instances",
    { headers: { "If-None-Match": "" } },
  );
  return entries.filter((item) => item.type === "dir");
}

export async function listManagedGoalFiles(
  octokit: Octokit = getOctokit(),
  owner = getOwner(),
  repo = getRepo(),
): Promise<ManagedGoalRecord[]> {
  const dirs = await listManagedGoalDirs(octokit, owner, repo);
  const goals: ManagedGoalRecord[] = [];

  for (const dir of dirs) {
    if (!dir.name) continue;
    const file = await readManagedGoalFile(dir.name, octokit, owner, repo);
    if (!file) continue;
    goals.push({
      id: dir.name,
      path: file.path,
      state: file.state,
      source: "local",
      recordType: "instance",
    });
  }

  return goals.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listCompanyStoreGoalTemplateFiles(
  octokit: Octokit = getOctokit(),
): Promise<ManagedGoalRecord[]> {
  const dirs = await listCompanyStoreDirectorySafe(octokit, GOAL_TEMPLATE_ROOT);
  const goals: ManagedGoalRecord[] = [];

  for (const dir of dirs) {
    if (dir.type !== "dir" || !dir.name) continue;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(dir.name)) continue;

    const path = `${GOAL_TEMPLATE_ROOT}/${dir.name}/state.json`;
    const raw = await readCompanyStoreText(octokit, path);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const state = normalizeManagedGoalState(parsed);
      if (!state) continue;
      goals.push({
        id: dir.name,
        path,
        state,
        source: "store",
        recordType: "template",
      });
    } catch {
      continue;
    }
  }

  return goals.sort((a, b) => a.id.localeCompare(b.id));
}

export async function writeManagedGoalFile({
  octokit,
  owner = getOwner(),
  repo = getRepo(),
  id,
  state,
  sha,
  message,
}: {
  octokit: Octokit;
  owner?: string;
  repo?: string;
  id: string;
  state: ManagedGoalState;
  sha?: string;
  message?: string;
}): Promise<void> {
  await writeStateText({
    octokit,
    owner,
    repo,
    path: managedGoalPath(id),
    message: message ?? `chore(goals): update managed goal ${id}`,
    content: JSON.stringify(state, null, 2),
    sha,
  });
}

export async function deleteManagedGoalFile({
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
    path: managedGoalPath(id),
    message: message ?? `chore(goals): delete managed goal ${id}`,
    sha,
  });
}
