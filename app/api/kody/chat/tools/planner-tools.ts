/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Goal-planner tools for the kody chat agent. Wired into the chat
 *   route only when the chat is opened in goal-planner mode (see
 *   `system-prompt.ts` -> "Goal planning mode"). The single tool here creates
 *   a real GitHub issue and attaches it to the goal via the `goal:<id>` label
 *   (the same label `GOAL_LABEL_PREFIX` uses on the dashboard side), so the
 *   issue immediately shows up under the goal's task list.
 *
 *   Body markup is reused from task-tools.ts so chat-created planner tasks
 *   are indistinguishable from tasks created via the New Task dialog.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import { PRIORITY_LEVELS, type PriorityLevel } from "@dashboard/lib/constants";
import { createIssueWithBestEffortMetadata } from "@dashboard/lib/github-issue-create";
import {
  CATEGORY_LABEL,
  CATEGORY_VALUES,
  formatTaskBody,
  taskInputSchema,
  type Category,
} from "./task-tools";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Login of the chat user. Default assignee for any task created. */
  actorLogin: string | null;
  /** The goal id this planner session is scoped to (becomes `goal:<id>` label). */
  goalId: string;
}

function appendWarnings(note: string, warnings: string[]): string {
  return warnings.length ? `${note} ${warnings.join(" ")}` : note;
}

// Mirror of GOAL_LABEL_PREFIX in src/dashboard/lib/goals.ts. Duplicated here
// rather than imported so the API tool stays decoupled from the dashboard
// component tree (the route already avoids deep `@dashboard` imports).
const GOAL_LABEL_PREFIX = "goal:";

export function createPlannerTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin, goalId } = ctx;
  const goalLabel = `${GOAL_LABEL_PREFIX}${goalId}`;
  const repoRef = `${owner}/${repo}`;

  return {
    create_task_for_goal: tool({
      description:
        `Create a single fully-specced GitHub issue in ${repoRef} and attach it to ` +
        `the current goal (label \`${goalLabel}\`). Use this **only** in goal-planning ` +
        "mode, after the user has approved the proposed task list. Call once per " +
        "approved task. Before calling, research the codebase (github_search_code, " +
        "github_get_file, github_blame) so the body is concrete: real file paths, " +
        "real symbol names, real edge cases. The issue body uses the same template " +
        "as the dashboard New Task dialog. Does NOT trigger the Kody pipeline — the " +
        "user runs `@kody` themselves when ready.",
      inputSchema: taskInputSchema.extend({
        category: z
          .enum(CATEGORY_VALUES as unknown as [Category, ...Category[]])
          .describe(
            'Task kind. "feature"=brand-new capability, "enhancement"=improve ' +
              'existing flow, "refactor"=restructure code, "docs"=documentation, ' +
              '"chore"=tooling/cleanup. Pick the closest fit.',
          ),
      }),
      execute: async (input) => {
        const priority: PriorityLevel = (input.priority ??
          "P2") as PriorityLevel;
        if (!PRIORITY_LEVELS.includes(priority)) {
          return { error: `Invalid priority: ${priority}` };
        }
        const category = input.category;
        const body = formatTaskBody(category, { ...input, priority });
        // Goal label first so the dashboard groups it correctly even if the
        // category/priority labels fail to apply for any reason.
        const labels = Array.from(
          new Set([goalLabel, category, `priority:${priority}`]),
        );
        const resolvedAssignees =
          input.assignees && input.assignees.length > 0
            ? input.assignees
            : actorLogin
              ? [actorLogin]
              : undefined;
        try {
          const { data, metadataWarnings } =
            await createIssueWithBestEffortMetadata(octokit, {
              owner,
              repo,
              title: input.title,
              body,
              labels,
              assignees: resolvedAssignees,
            });
          logger.info(
            { owner, repo, number: data.number, goalId, category, priority },
            "create_task_for_goal: created issue",
          );
          return {
            number: data.number,
            title: data.title,
            url: data.html_url,
            labels,
            assignees: data.assignees
              ?.map((a) => a?.login)
              .filter(Boolean) as string[],
            priority,
            category,
            categoryLabel: CATEGORY_LABEL[category],
            goalId,
            note: appendWarnings(
              `${CATEGORY_LABEL[category]} task filed and attached to goal "${goalId}". ` +
                "Kody pipeline NOT auto-triggered — comment `@kody` on the issue to run it.",
              metadataWarnings,
            ),
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, goalId, category, title: input.title },
            "create_task_for_goal failed",
          );
          return {
            error:
              err instanceof Error
                ? err.message
                : "Failed to create task issue",
          };
        }
      },
    }),
  };
}
