/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Goal tools for the kody-direct chat agent. Goals are NOT
 *   issues — they live as JSON in a manifest issue and are surfaced to
 *   users as GitHub Discussions referenced by `#<discussionNumber>`. The
 *   plain GitHub tools (`github_get_issue`) can't see them, so the agent
 *   needs these to read a goal by its number and to attach/detach
 *   existing task issues to a goal.
 *
 * Reads go through the shared goals-server concern (canonical manifest
 * reader, same source the /api/kody/goals route uses). Membership is a
 * `goal:<id>` label on the task issue, so attach/detach is a label
 * mutation on the task + a cache invalidation (no manifest write).
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import { invalidateIssueCache } from "@dashboard/lib/github-client";
import { readGoalsManifestFresh } from "@dashboard/lib/goals-server";
import { GOAL_LABEL_PREFIX, type Goal } from "@dashboard/lib/goals";
import { listStateDirectory, readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  buildManagedGoalState,
  isManagedGoalState,
  managedGoalPath,
  slugifyManagedGoalId,
  type ManagedGoalRecord,
} from "@dashboard/lib/managed-goals";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

const MAX_DESC_CHARS = 4_000;
const MAX_ATTACHED_TASKS = 50;

async function readManagedGoalFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  goalId: string,
): Promise<{ raw: string; sha: string } | null> {
  const file = await readStateText(octokit, owner, repo, managedGoalPath(goalId), {
    headers: { "If-None-Match": "" },
  });
  return file ? { raw: file.content, sha: file.sha } : null;
}

async function listManagedGoalDirs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Array<{ name: string }>> {
  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    "goals/instances",
    { headers: { "If-None-Match": "" } },
  );
  return entries
    .filter((item) => item.type === "dir" && typeof item.name === "string")
    .map((item) => ({ name: item.name }));
}

async function listManagedGoals(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ManagedGoalRecord[]> {
  const dirs = await listManagedGoalDirs(octokit, owner, repo);
  const goals: ManagedGoalRecord[] = [];
  for (const dir of dirs) {
    if (!dir.name) continue;
    const file = await readManagedGoalFile(octokit, owner, repo, dir.name);
    if (!file) continue;
    const parsed = JSON.parse(file.raw) as unknown;
    if (!isManagedGoalState(parsed)) continue;
    goals.push({
      id: dir.name,
      path: managedGoalPath(dir.name),
      state: parsed,
    });
  }
  return goals.sort((a, b) => a.id.localeCompare(b.id));
}

async function dispatchGoalWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const repoMeta = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoMeta.data.default_branch || "main";
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "kody.yml",
      ref: defaultBranch,
    });
    return true;
  } catch (err) {
    logger.warn({ err, owner, repo }, "create_managed_goal dispatch failed");
    return false;
  }
}

function clip(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}\n[... truncated ...]` : s;
}

/** Public-facing summary of a goal — the shape every tool returns. */
function summarize(goal: Goal) {
  return {
    // The user-facing id: the backing Discussion number (null when the
    // repo has Discussions off — the goal is then only addressable by id).
    number: goal.discussionNumber ?? null,
    id: goal.id,
    name: goal.name,
    dueDate: goal.dueDate ?? null,
    assignee: goal.assignee ?? null,
    // The label that ties task issues to this goal. The agent can pass
    // this straight to `github_list_issues` to see the goal's tasks.
    taskLabel: `${GOAL_LABEL_PREFIX}${goal.id}`,
  };
}

function resolveGoal(
  goals: Goal[],
  number: number | undefined,
  id: string | undefined,
): Goal | undefined {
  if (typeof number === "number") {
    const byNum = goals.find((g) => g.discussionNumber === number);
    if (byNum) return byNum;
  }
  if (id) {
    const key = id.toLowerCase();
    return goals.find((g) => g.id.toLowerCase() === key);
  }
  return undefined;
}

export function createGoalTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;

  return {
    list_goals: tool({
      description:
        "List all missions in this repo. Missions are legacy task-page groupings, not issues — they are " +
        "surfaced as GitHub Discussions referenced by #<number>. Use this " +
        "to map a mission number/name to its details, or to enumerate missions.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { manifest } = await readGoalsManifestFresh();
          return { goals: manifest.goals.map(summarize) };
        } catch (err) {
          logger.warn({ err, owner, repo }, "list_goals failed");
          return { error: "Could not read the goals manifest." };
        }
      },
    }),

    get_goal: tool({
      description:
        "Fetch a single mission by its #<number> (the Discussion number shown " +
        "next to the mission title) or by its slug id, including its " +
        "description and the task issues currently attached to it. Use " +
        "this — NOT github_get_issue — whenever the user references a mission, old goal, task-page goal, or goal group " +
        '(e.g. "explain mission 1533"); mission numbers are not issue numbers.',
      inputSchema: z.object({
        number: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The goal's Discussion number (as shown: #1533)"),
        id: z
          .string()
          .optional()
          .describe("The goal's slug id (alternative to number)"),
      }),
      execute: async ({ number, id }) => {
        try {
          const { manifest } = await readGoalsManifestFresh();
          const goal = resolveGoal(manifest.goals, number, id);
          if (!goal) {
            return {
              error:
                `No goal ${number != null ? `#${number}` : (id ?? "")} ` +
                "found. Call list_goals to see available goals.",
            };
          }
          const label = `${GOAL_LABEL_PREFIX}${goal.id}`;
          let attachedTasks: Array<{
            number: number;
            title: string;
            state: string;
          }> = [];
          try {
            const res = await octokit.rest.issues.listForRepo({
              owner,
              repo,
              labels: label,
              state: "all",
              per_page: MAX_ATTACHED_TASKS,
            });
            attachedTasks = res.data
              .filter((i) => !i.pull_request)
              .map((i) => ({
                number: i.number,
                title: i.title,
                state: i.state,
              }));
          } catch (err) {
            logger.warn(
              { err, owner, repo, label },
              "get_goal: attached-task lookup failed",
            );
          }
          return {
            goal: {
              ...summarize(goal),
              description: clip(goal.description, MAX_DESC_CHARS),
              createdAt: goal.createdAt,
              updatedAt: goal.updatedAt ?? null,
            },
            attachedTasks,
          };
        } catch (err) {
          logger.warn({ err, owner, repo, number, id }, "get_goal failed");
          return { error: "Could not read the goals manifest." };
        }
      },
    }),

    list_managed_goals: tool({
      description:
        "List engine-managed goals stored in the configured Kody state repo at goals/instances/<id>/state.json. " +
        "Use for company goals with outcome, evidence, route, facts, and blockers.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const goals = await listManagedGoals(octokit, owner, repo);
          return {
            goals: goals.map((goal) => ({
              id: goal.id,
              path: goal.path,
              state: goal.state.state,
              type: goal.state.type,
              outcome: goal.state.destination.outcome,
              evidence: goal.state.destination.evidence,
              stage: goal.state.stage ?? null,
              blockers: goal.state.blockers,
            })),
          };
        } catch (err) {
          logger.warn({ err, owner, repo }, "list_managed_goals failed");
          return { error: "Could not list managed goals." };
        }
      },
    }),

    get_managed_goal: tool({
      description:
        "Read one engine-managed goal by slug id from the configured Kody state repo. " +
        "Use this for a goal's outcome, evidence, route, facts, and blockers.",
      inputSchema: z.object({
        id: z.string().min(1).max(100).describe("Managed goal slug id"),
      }),
      execute: async ({ id }) => {
        try {
          const file = await readManagedGoalFile(octokit, owner, repo, id);
          if (!file) return { error: `Managed goal "${id}" not found.` };
          const parsed = JSON.parse(file.raw) as unknown;
          if (!isManagedGoalState(parsed)) {
            return { error: `Goal "${id}" is not a managed-goal file.` };
          }
          return {
            goal: {
              id,
              path: managedGoalPath(id),
              state: parsed,
            },
          };
        } catch (err) {
          logger.warn({ err, owner, repo, id }, "get_managed_goal failed");
          return { error: "Could not read managed goal." };
        }
      },
    }),

    create_managed_goal: tool({
      description:
        "Create an engine-managed company goal. Provide a finish-line outcome, " +
        "proof/evidence keys, and route steps that name agentResponsibility/agentAction work. " +
        "Writes the configured Kody state repo at goals/instances/<id>/state.json and wakes Kody.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Optional slug id. If omitted, derived from outcome."),
        type: z
          .string()
          .min(1)
          .max(80)
          .default("general")
          .describe("Goal kind, e.g. release, qa, docs, test."),
        outcome: z
          .string()
          .min(1)
          .max(500)
          .describe("Human finish line. Example: Version 1.2.3 is published."),
        evidence: z
          .array(z.string().min(1).max(80))
          .min(1)
          .describe("Proof keys required for done, e.g. qaPassed."),
        route: z
          .array(
            z.object({
              stage: z.string().min(1).max(80),
              evidence: z.string().min(1).max(80),
              agentResponsibility: z.string().min(1).max(80),
              agentAction: z.string().min(1).max(80).optional(),
            }),
          )
          .min(1)
          .describe("One route step per evidence key."),
      }),
      execute: async (input) => {
        try {
          const goalId =
            slugifyManagedGoalId(input.id ?? "") ||
            slugifyManagedGoalId(input.outcome);
          if (!goalId) return { error: "Could not derive a valid goal id." };

          const path = managedGoalPath(goalId);
          const existing = await readManagedGoalFile(
            octokit,
            owner,
            repo,
            goalId,
          );
          if (existing) {
            return { error: `Managed goal "${goalId}" already exists.` };
          }

          const state = buildManagedGoalState(input);
          await writeStateText({
            octokit,
            owner,
            repo,
            path,
            message: `chore(goals): create managed goal ${goalId}`,
            content: JSON.stringify(state, null, 2),
          });

          const engineDispatched = await dispatchGoalWorkflow(
            octokit,
            owner,
            repo,
          );

          return {
            ok: true,
            goal: { id: goalId, path, state },
            engineDispatched,
            note: engineDispatched
              ? "Managed goal created and Kody was woken."
              : "Managed goal created. Kody scheduler can pick it up later.",
          };
        } catch (err) {
          logger.warn({ err, owner, repo }, "create_managed_goal failed");
          return {
            error:
              err instanceof Error ? err.message : "Could not create goal.",
          };
        }
      },
    }),

    attach_task_to_goal: tool({
      description:
        "Attach an existing task issue to a mission by adding the mission's " +
        "membership label to the issue. Identify the mission by its " +
        "#<number> or slug id.",
      inputSchema: z.object({
        taskNumber: z
          .number()
          .int()
          .positive()
          .describe("The task issue number to attach"),
        goalNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The goal's Discussion number"),
        goalId: z
          .string()
          .optional()
          .describe("The goal's slug id (alternative to goalNumber)"),
      }),
      execute: async ({ taskNumber, goalNumber, goalId }) => {
        try {
          const { manifest } = await readGoalsManifestFresh();
          const goal = resolveGoal(manifest.goals, goalNumber, goalId);
          if (!goal) {
            return {
            error: "Mission not found. Call list_goals to see missions.",
            };
          }
          const label = `${GOAL_LABEL_PREFIX}${goal.id}`;
          await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: taskNumber,
            labels: [label],
          });
          invalidateIssueCache(taskNumber);
          return {
            ok: true,
          message: `Attached #${taskNumber} to mission "${goal.name}".`,
            taskLabel: label,
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, taskNumber },
            "attach_task_to_goal failed",
          );
          return {
            error: `Could not attach #${taskNumber} (does the issue exist?).`,
          };
        }
      },
    }),

    detach_task_from_goal: tool({
      description:
        "Detach a task issue from a mission by removing the mission's " +
        "membership label from the issue. No-op if it wasn't attached.",
      inputSchema: z.object({
        taskNumber: z
          .number()
          .int()
          .positive()
          .describe("The task issue number to detach"),
        goalNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The goal's Discussion number"),
        goalId: z
          .string()
          .optional()
          .describe("The goal's slug id (alternative to goalNumber)"),
      }),
      execute: async ({ taskNumber, goalNumber, goalId }) => {
        try {
          const { manifest } = await readGoalsManifestFresh();
          const goal = resolveGoal(manifest.goals, goalNumber, goalId);
          if (!goal) {
            return {
            error: "Mission not found. Call list_goals to see missions.",
            };
          }
          const label = `${GOAL_LABEL_PREFIX}${goal.id}`;
          try {
            await octokit.rest.issues.removeLabel({
              owner,
              repo,
              issue_number: taskNumber,
              name: label,
            });
          } catch (err) {
            // 404 = the label wasn't on the issue; treat as a no-op.
            const status = (err as { status?: number }).status;
            if (status !== 404) throw err;
          }
          invalidateIssueCache(taskNumber);
          return {
            ok: true,
          message: `Detached #${taskNumber} from mission "${goal.name}".`,
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, taskNumber },
            "detach_task_from_goal failed",
          );
          return { error: `Could not detach #${taskNumber}.` };
        }
      },
    }),
  };
}
