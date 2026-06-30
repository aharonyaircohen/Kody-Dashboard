/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals-files
 * @ai-summary Read and write managed goal state through todo-list files in
 * the configured Kody state repo, with a legacy JSON read fallback.
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
  parseTodoFileContent,
  serializeTodoFileContent,
  type TodoFileContent,
} from "./todos/files";
import {
  isManagedGoalTodo,
  managedGoalStateToTodoContent,
  todoToManagedGoalState,
} from "./managed-goals-todo";
import {
  legacyManagedGoalPath,
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
  type ManagedGoalState,
} from "./managed-goals";

const GOAL_TEMPLATE_ROOT = ".kody/goals/templates";
const TODOS_ROOT = "todos";
const LEGACY_GOAL_ROOT = "goals/instances";

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
): Promise<{
  state: ManagedGoalState;
  sha?: string;
  path: string;
  source: "todo" | "legacy";
} | null> {
  const path = managedGoalPath(goalId);
  const todoFile = await readStateText(octokit, owner, repo, path, {
    headers: { "If-None-Match": "" },
  }).catch((error: unknown) => {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  });

  if (todoFile) {
    const todo = parseTodoFileContent(
      todoFile.content,
      goalId,
      new Date().toISOString(),
    );
    if (!isManagedGoalTodo(todo)) return null;
    const state = todoToManagedGoalState(goalId, todo);
    if (state) return { state, sha: todoFile.sha, path, source: "todo" };
  }

  const legacyPath = legacyManagedGoalPath(goalId);
  const legacyFile = await readStateText(octokit, owner, repo, legacyPath, {
    headers: { "If-None-Match": "" },
  }).catch((error: unknown) => {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  });
  if (!legacyFile) return null;
  const parsed = JSON.parse(legacyFile.content) as unknown;
  const state = normalizeManagedGoalState(parsed);
  if (!state) return null;
  return { state, sha: legacyFile.sha, path: legacyPath, source: "legacy" };
}

async function listManagedTodoFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ContentFile[]> {
  try {
    const { entries } = await listStateDirectory(
      octokit,
      owner,
      repo,
      TODOS_ROOT,
      {
        headers: { "If-None-Match": "" },
      },
    );
    return entries.filter((item) => item.type === "file");
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }
}

async function listLegacyManagedGoalDirs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ContentFile[]> {
  try {
    const { entries } = await listStateDirectory(
      octokit,
      owner,
      repo,
      LEGACY_GOAL_ROOT,
      { headers: { "If-None-Match": "" } },
    );
    return entries.filter((item) => item.type === "dir");
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }
}

export async function listManagedGoalFiles(
  octokit: Octokit = getOctokit(),
  owner = getOwner(),
  repo = getRepo(),
): Promise<ManagedGoalRecord[]> {
  const goals: ManagedGoalRecord[] = [];
  const seen = new Set<string>();

  for (const entry of await listManagedTodoFiles(octokit, owner, repo)) {
    if (!entry.name?.endsWith(".md")) continue;
    const id = entry.name.slice(0, -3);
    const file = await readManagedGoalFile(id, octokit, owner, repo);
    if (!file) continue;
    goals.push({
      id,
      path: file.path,
      state: file.state,
      source: "local",
      recordType: "instance",
    });
    seen.add(id);
  }

  for (const dir of await listLegacyManagedGoalDirs(octokit, owner, repo)) {
    if (!dir.name || seen.has(dir.name)) continue;
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
  const currentTodo = await readManagedGoalTodoContent(
    id,
    octokit,
    owner,
    repo,
  );
  if (currentTodo && !isManagedGoalTodo(currentTodo)) {
    throw new Error(`Cannot overwrite regular todo list ${id} as managed goal`);
  }
  const existing = await readManagedGoalFile(id, octokit, owner, repo);
  const previousTodo = existing?.source === "todo" ? currentTodo : null;
  const content = serializeTodoFileContent(
    managedGoalStateToTodoContent(id, state, previousTodo),
  );

  await writeStateText({
    octokit,
    owner,
    repo,
    path: managedGoalPath(id),
    message: message ?? `chore(goals): update managed goal ${id}`,
    content,
    sha: existing?.source === "todo" ? (sha ?? existing.sha) : undefined,
  });
}

async function readManagedGoalTodoContent(
  id: string,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<TodoFileContent | null> {
  const file = await readStateText(octokit, owner, repo, managedGoalPath(id), {
    headers: { "If-None-Match": "" },
  }).catch((error: unknown) => {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  });
  return file
    ? parseTodoFileContent(file.content, id, new Date().toISOString())
    : null;
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
  sha?: string;
  message?: string;
}): Promise<void> {
  const existing = await readManagedGoalFile(id, octokit, owner, repo);
  if (!existing?.sha) return;
  await deleteStateFile({
    octokit,
    owner,
    repo,
    path:
      existing.source === "todo"
        ? managedGoalPath(id)
        : legacyManagedGoalPath(id),
    message: message ?? `chore(goals): delete managed goal ${id}`,
    sha: sha ?? existing.sha,
  });
}
