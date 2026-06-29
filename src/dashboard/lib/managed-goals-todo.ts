/**
 * @fileType utility
 * @domain kody
 * @pattern managed-goals-todo
 * @ai-summary Converts between managed goal domain state and todo-list files.
 */

import {
  managedGoalModel,
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
  type ManagedGoalRouteStep,
  type ManagedGoalState,
} from "./managed-goals";
import type { TodoFileContent, TodoItemFile } from "./todos/files";

export function isManagedGoalTodo(todo: TodoFileContent): boolean {
  const frontmatter = todo.frontmatter ?? {};
  return (
    frontmatter.managed === true ||
    frontmatter.managed === "true" ||
    frontmatter.managedModel === "agentGoal" ||
    frontmatter.managedModel === "agentLoop"
  );
}

export function todoToManagedGoalState(
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
              return typeof meta?.evidence === "string"
                ? meta.evidence
                : item.id;
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

export function managedGoalStateToTodoContent(
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
