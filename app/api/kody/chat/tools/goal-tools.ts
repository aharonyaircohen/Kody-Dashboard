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

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

const MAX_DESC_CHARS = 4_000;
const MAX_ATTACHED_TASKS = 50;

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
        "List all goals in this repo. Goals are NOT issues — they are " +
        "surfaced as GitHub Discussions referenced by #<number>. Use this " +
        "to map a goal number/name to its details, or to enumerate goals.",
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
        "Fetch a single goal by its #<number> (the Discussion number shown " +
        "next to the goal title) or by its slug id, including its " +
        "description and the task issues currently attached to it. Use " +
        "this — NOT github_get_issue — whenever the user references a goal " +
        "(e.g. \"explain goal 1533\"); goal numbers are not issue numbers.",
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

    attach_task_to_goal: tool({
      description:
        "Attach an existing task issue to a goal by adding the goal's " +
        "membership label to the issue. Identify the goal by its " +
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
              error: "Goal not found. Call list_goals to see goals.",
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
            message: `Attached #${taskNumber} to goal "${goal.name}".`,
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
        "Detach a task issue from a goal by removing the goal's " +
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
              error: "Goal not found. Call list_goals to see goals.",
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
            message: `Detached #${taskNumber} from goal "${goal.name}".`,
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
