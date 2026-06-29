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
  type TodoItemFile,
} from "./todos/files";
import {
  legacyManagedGoalPath,
  managedGoalModel,
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
  type ManagedGoalRouteStep,
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
    const { entries } = await listStateDirectory(octokit, owner, repo, TODOS_ROOT, {
      headers: { "If-None-Match": "" },
    });
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
  const currentTodo = await readManagedGoalTodoContent(id, octokit, owner, repo);
  if (currentTodo && !isManagedGoalTodo(currentTodo)) {
    throw new Error(`Cannot overwrite regular todo list ${id} as managed goal`);
  }
  const existing = await readManagedGoalFile(id, octokit, owner, repo);
  const previousTodo =
    existing?.source === "todo" ? currentTodo : null;
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
    path: existing.source === "todo" ? managedGoalPath(id) : legacyManagedGoalPath(id),
    message: message ?? `chore(goals): delete managed goal ${id}`,
    sha: sha ?? existing.sha,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isManagedGoalTodo(todo: TodoFileContent): boolean {
  const frontmatter = todo.frontmatter ?? {};
  return (
    frontmatter.managed === true ||
    frontmatter.managed === "true" ||
    frontmatter.managedModel === "agentGoal" ||
    frontmatter.managedModel === "agentLoop"
  );
}

function routeFromItems(items: TodoItemFile[]): ManagedGoalRouteStep[] {
  return items.flatMap((item) => {
    const meta = asRecord(item.meta);
    if (!meta) return [];
    const stage = typeof meta.stage === "string" ? meta.stage : "";
    const evidence =
      typeof meta.evidence === "string" ? meta.evidence : item.id;
    const capability =
      typeof meta.capability === "string" ? meta.capability : "";
    if (!stage || !evidence || !capability) return [];
    return [
      {
        stage,
        evidence,
        capability,
        ...(meta.saveReport === true ? { saveReport: true } : {}),
        ...(asRecord(meta.args) ? { args: asRecord(meta.args)! } : {}),
      },
    ];
  });
}

function todoToManagedGoalState(
  id: string,
  todo: TodoFileContent,
): ManagedGoalState | null {
  const frontmatter = todo.frontmatter ?? {};
  const rawDestination = asRecord(frontmatter.destination);
  const route = Array.isArray(frontmatter.route)
    ? (frontmatter.route as ManagedGoalRouteStep[])
    : routeFromItems(todo.items);
  const evidence =
    rawDestination && Array.isArray(rawDestination.evidence)
      ? asStringArray(rawDestination.evidence)
      : asStringArray(frontmatter.evidence).length > 0
        ? asStringArray(frontmatter.evidence)
        : todo.items
            .map((item) => {
              const meta = asRecord(item.meta);
              return typeof meta?.evidence === "string" ? meta.evidence : item.id;
            })
            .filter(Boolean);
  const facts = {
    ...(asRecord(frontmatter.facts) ?? {}),
    ...Object.fromEntries(
      todo.items
        .map((item) => {
          const meta = asRecord(item.meta);
          const key =
            typeof meta?.evidence === "string" ? meta.evidence : item.id;
          return key ? [key, item.completed] : null;
        })
        .filter((entry): entry is [string, boolean] => entry !== null),
    ),
  };

  return normalizeManagedGoalState({
    ...frontmatter,
    id,
    title: todo.title,
    version: frontmatter.version ?? 1,
    state: frontmatter.state ?? "active",
    type: frontmatter.type ?? "general",
    destination: {
      ...(rawDestination ?? {}),
      outcome:
        todo.description ||
        (typeof rawDestination?.outcome === "string"
          ? rawDestination.outcome
          : ""),
      evidence,
    },
    capabilities:
      asStringArray(frontmatter.capabilities).length > 0
        ? asStringArray(frontmatter.capabilities)
        : route.map((step) => step.capability).filter(Boolean),
    route,
    facts,
    blockers: asStringArray(frontmatter.blockers),
  });
}

function managedGoalStateToTodoContent(
  id: string,
  state: ManagedGoalState,
  previous?: TodoFileContent | null,
): TodoFileContent {
  const now = new Date().toISOString();
  const routeByEvidence = new Map(
    state.route.map((step) => [step.evidence, step] as const),
  );
  const previousItems = new Map(
    previous?.items.map((item) => [item.id, item] as const) ?? [],
  );

  const evidenceItems = state.destination.evidence.map((evidence) => {
    const step = routeByEvidence.get(evidence);
    const prior = previousItems.get(evidence);
    const completed = state.facts[evidence] === true;
    return {
      id: evidence,
      title: prior?.title ?? step?.stage ?? evidence,
      body: prior?.body ?? "",
      assignee: prior?.assignee ?? null,
      completed,
      createdAt:
        prior?.createdAt ??
        (typeof state.createdAt === "string" ? state.createdAt : now),
      completedAt: completed
        ? (prior?.completedAt ??
          (typeof state.updatedAt === "string" ? state.updatedAt : now))
        : null,
      meta: {
        ...(prior?.meta ?? {}),
        evidence,
        ...(step
          ? {
              stage: step.stage,
              capability: step.capability,
              ...(step.saveReport === true ? { saveReport: true } : {}),
              ...(step.args ? { args: step.args } : {}),
            }
          : {}),
      },
    } satisfies TodoItemFile;
  });

  const loopItems =
    evidenceItems.length > 0
      ? []
      : state.capabilities.map((capability) => {
          const prior = previousItems.get(capability);
          const status = state.scheduleState?.capabilities?.[capability];
          return {
            id: capability,
            title: prior?.title ?? status?.title ?? capability,
            body: prior?.body ?? "",
            assignee: prior?.assignee ?? null,
            completed: status?.state === "disabled",
            createdAt:
              prior?.createdAt ??
              (typeof state.createdAt === "string" ? state.createdAt : now),
            completedAt:
              status?.state === "disabled"
                ? (prior?.completedAt ??
                  (typeof state.updatedAt === "string"
                    ? state.updatedAt
                    : now))
                : null,
            meta: {
              ...(prior?.meta ?? {}),
              capability,
              ...(status ? { scheduleStatus: status } : {}),
            },
          } satisfies TodoItemFile;
        });

  const record: ManagedGoalRecord = {
    id,
    path: managedGoalPath(id),
    state,
    source: "local",
    recordType: "instance",
  };
  const model = managedGoalModel(record);
  const { destination, route, facts, blockers, capabilities, ...rest } = state;
  void destination;
  void route;
  void facts;
  void blockers;
  void capabilities;

  return {
    title: id,
    description: state.destination.outcome,
    createdAt: typeof state.createdAt === "string" ? state.createdAt : now,
    frontmatter: {
      ...rest,
      id,
      title: id,
      createdAt: typeof state.createdAt === "string" ? state.createdAt : now,
      managed: true,
      managedModel: model,
      version: state.version,
      state: state.state,
      type: state.type,
      evidence: state.destination.evidence,
      capabilities: state.capabilities,
      route: state.route,
      facts: state.facts,
      blockers: state.blockers,
    },
    items: [...evidenceItems, ...loopItems],
  };
}
