/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Task-creation tools for the kody-direct chat agent. One tool
 * per UI category (feature / enhancement / refactor / documentation / chore)
 * mirroring the dashboard's CreateTaskDialog. Labels and markdown body match
 * the dialog 1:1 so chat-created issues are indistinguishable from dialog-
 * created ones. Like report_bug, none of these auto-trigger the Kody
 * pipeline — the user runs `@kody` themselves when ready.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import { createIssueWithBestEffortMetadata } from "@dashboard/lib/github-issue-create";
import { dashboardTaskUrl } from "@dashboard/lib/thread-link";
import {
  PRIORITY_LEVELS,
  PRIORITY_META,
  type PriorityLevel,
} from "@dashboard/lib/constants";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Used as the default assignee when the model
  // doesn't supply one — every chat-created task should be attributable.
  actorLogin: string | null;
  // Ambient preview/page evidence collected by the chat shell for this turn.
  previewContext?: string | null;
}

const SCOPES = ["frontend", "backend", "fullstack", "infra", "ci-cd"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_LABEL: Record<Scope, string> = {
  frontend: "Frontend",
  backend: "Backend",
  fullstack: "Full-stack",
  infra: "Infrastructure",
  "ci-cd": "CI / CD",
};

// Keep these in sync with CreateTaskDialog's CATEGORY_META label + the
// header it picks per category in formatBody().
export type Category =
  | "feature"
  | "enhancement"
  | "refactor"
  | "docs"
  | "chore";

export const CATEGORY_VALUES: readonly Category[] = [
  "feature",
  "enhancement",
  "refactor",
  "docs",
  "chore",
] as const;

export const CATEGORY_LABEL: Record<Category, string> = {
  feature: "New Feature",
  enhancement: "Enhancement",
  refactor: "Refactor",
  docs: "Documentation",
  chore: "Chore",
};

// The dialog uses different "what" headers per category. Match exactly.
const REQUIREMENTS_HEADER: Record<Category, string> = {
  feature: "Requirements",
  enhancement: "Requirements",
  refactor: "What to Refactor",
  docs: "Documentation Scope",
  chore: "What Needs to Change",
};

export interface TaskInput {
  title: string;
  summary: string;
  requirements: string;
  scope?: Scope;
  priority?: PriorityLevel;
  affectedArea?: string;
  acceptanceCriteria?: string;
  additionalContext?: string;
  assignees?: string[];
}

function normalizeContextBlock(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function appendPreviewContextToTaskInput(
  input: TaskInput,
  previewContext: string | null | undefined,
): TaskInput {
  const preview = normalizeContextBlock(previewContext);
  if (!preview) return input;

  const existing = normalizeContextBlock(input.additionalContext);
  if (existing?.includes(preview)) {
    return { ...input, additionalContext: existing };
  }

  const viewBlock = `### View Example - Required Visual Contract
The view below is the required visual source for this task. Reproduce its layout, spacing, typography, color, content hierarchy, and interaction feel as closely as the target app allows.

Do not substitute a new design direction unless the issue requirements explicitly ask for changes or the source conflicts with the target app's design system. If exact matching is impossible, state what could not be matched and why in the implementation notes.

${preview}`;
  return {
    ...input,
    additionalContext: existing ? `${existing}\n\n${viewBlock}` : viewBlock,
  };
}

export function formatTaskBody(category: Category, input: TaskInput): string {
  const {
    title,
    summary,
    requirements,
    scope = "fullstack",
    priority = "P2",
    affectedArea,
    acceptanceCriteria,
    additionalContext,
  } = input;

  const catLabel = CATEGORY_LABEL[category];
  const scopeLabel = SCOPE_LABEL[scope];
  const prioMeta = PRIORITY_META[priority];
  const reqHeader = REQUIREMENTS_HEADER[category];

  let body = `# ${catLabel}: ${title}\n\n`;

  body += "| | |\n|---|---|\n";
  body += `| **Category** | ${catLabel} |\n`;
  body += `| **Scope** | ${scopeLabel} |\n`;
  body += `| **Priority** | ${prioMeta.badge} ${priority} — ${prioMeta.label} |\n\n`;

  body += "## Summary\n";
  body += `${summary || "_No summary provided_"}\n\n`;

  body += `## ${reqHeader}\n`;
  body += `${requirements || "_Not specified_"}\n\n`;

  if (affectedArea) {
    body += "## Affected Area\n";
    body += `${affectedArea}\n\n`;
  }

  if (acceptanceCriteria) {
    body += "## Acceptance Criteria\n";
    body += `${acceptanceCriteria}\n\n`;
  }

  if (additionalContext) {
    body += "## Additional Context\n";
    body += `${additionalContext}\n\n`;
  }

  return body;
}

function appendWarnings(note: string, warnings: string[]): string {
  return warnings.length ? `${note} ${warnings.join(" ")}` : note;
}

// Shared input schema. Field text per category is set in the tool description
// (e.g. "what to refactor" vs "requirements") — schema stays uniform so the
// model can call any of the five with the same fields.
export const taskInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Short task title (becomes the GitHub issue title)."),
  summary: z
    .string()
    .min(1)
    .describe(
      "1–3 sentence overview of what this task is about and why it matters.",
    ),
  requirements: z
    .string()
    .min(1)
    .describe(
      'The "what" of the task — for features/enhancements: requirements; ' +
        "for refactors: what to refactor and why; for docs: documentation scope; " +
        "for chores: what needs to change.",
    ),
  scope: z
    .enum(SCOPES)
    .optional()
    .describe('Where the work lives. Defaults to "fullstack".'),
  priority: z
    .enum(PRIORITY_LEVELS)
    .optional()
    .describe("Priority. P0=Critical, P1=High, P2=Medium (default), P3=Low."),
  affectedArea: z
    .string()
    .optional()
    .describe("Specific files, modules, or surfaces this touches. Optional."),
  acceptanceCriteria: z
    .string()
    .optional()
    .describe(
      'Bullet list of conditions under which the task is "done". Optional but strongly preferred.',
    ),
  additionalContext: z
    .string()
    .optional()
    .describe(
      "Anything else that helps Kody plan and implement: links, prior decisions, constraints. Optional.",
    ),
  assignees: z
    .array(z.string())
    .optional()
    .describe(
      "GitHub logins to assign — only set when the user explicitly asks for it.",
    ),
});

async function executeCreate(
  ctx: Ctx,
  category: Category,
  input: TaskInput,
): Promise<
  | {
      number: number;
      title: string;
      url: string;
      labels: string[];
      assignees: string[];
      priority: PriorityLevel;
      category: Category;
      note: string;
    }
  | { error: string }
> {
  const { octokit, owner, repo, actorLogin } = ctx;
  const priority: PriorityLevel = input.priority ?? "P2";
  const body = formatTaskBody(category, {
    ...appendPreviewContextToTaskInput(input, ctx.previewContext),
    priority,
  });
  // Match CreateTaskDialog labeling: <category> + priority:<level>.
  // De-dupe in case the model passes something redundant.
  const labels = Array.from(new Set([category, `priority:${priority}`]));

  // Default assignee to the chat actor when the model didn't supply one,
  // mirroring the dashboard's CreateTaskDialog/POST fallback so every
  // chat-created task is attributable to a person.
  const resolvedAssignees =
    input.assignees && input.assignees.length > 0
      ? input.assignees
      : actorLogin
        ? [actorLogin]
        : undefined;

  try {
    const { data, metadataWarnings } = await createIssueWithBestEffortMetadata(
      octokit,
      {
        owner,
        repo,
        title: input.title,
        body,
        labels,
        assignees: resolvedAssignees,
      },
    );
    logger.info(
      { owner, repo, number: data.number, category, priority },
      "create_task: created issue",
    );
    return {
      number: data.number,
      title: data.title,
      url: dashboardTaskUrl(data.number, { owner, repo }),
      labels,
      assignees: data.assignees
        ?.map((a) => a?.login)
        .filter(Boolean) as string[],
      priority,
      category,
      note: appendWarnings(
        `${CATEGORY_LABEL[category]} task filed. Kody pipeline NOT auto-triggered — comment \`@kody\` on the issue to run it.`,
        metadataWarnings,
      ),
    };
  } catch (err) {
    logger.warn(
      { err, owner, repo, category, title: input.title },
      "create_task failed",
    );
    return {
      error: err instanceof Error ? err.message : "Failed to create task issue",
    };
  }
}

export function createTaskTools(ctx: Ctx) {
  const { owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    create_feature: tool({
      description:
        `Open a structured "New Feature" task as a GitHub issue in ${repoRef}. ` +
        "Use when the user wants to add a brand-new capability that does not exist " +
        'yet (e.g. "add dark mode", "build a new export flow"). Labels: ' +
        '["feature", "priority:<level>"]. Body uses the same template as the ' +
        "dashboard's Create Task dialog. Does NOT trigger the Kody pipeline. " +
        "Before calling, gather: title, summary, and requirements. Ask the user for " +
        "missing critical fields rather than inventing them.",
      inputSchema: taskInputSchema,
      execute: (input) => executeCreate(ctx, "feature", input),
    }),

    create_enhancement: tool({
      description:
        `Open a structured "Enhancement" task as a GitHub issue in ${repoRef}. ` +
        "Use when the user wants to improve an existing feature or flow (e.g. " +
        '"make the search faster", "improve error messages on login"). Labels: ' +
        '["enhancement", "priority:<level>"]. Body matches the dashboard\'s ' +
        "Create Task dialog. Does NOT trigger the Kody pipeline. Ask for any " +
        "missing critical fields rather than inventing them.",
      inputSchema: taskInputSchema,
      execute: (input) => executeCreate(ctx, "enhancement", input),
    }),

    create_refactor: tool({
      description:
        `Open a structured "Refactor" task as a GitHub issue in ${repoRef}. ` +
        "Use when the user wants to restructure code without changing behavior " +
        '(e.g. "extract X into its own module", "split this 1000-line file"). ' +
        'Labels: ["refactor", "priority:<level>"]. The `requirements` field ' +
        "should describe what to refactor and why. Body matches the Create Task " +
        "dialog. Does NOT trigger the Kody pipeline.",
      inputSchema: taskInputSchema,
      execute: (input) => executeCreate(ctx, "refactor", input),
    }),

    create_documentation: tool({
      description:
        `Open a structured "Documentation" task as a GitHub issue in ${repoRef}. ` +
        "Use when the user wants to add or update docs, READMEs, or code comments " +
        '(e.g. "document the auth flow", "add an architecture overview"). Labels: ' +
        '["docs", "priority:<level>"]. The `requirements` field should describe ' +
        "the documentation scope (what should be documented and where). Body " +
        "matches the Create Task dialog. Does NOT trigger the Kody pipeline.",
      inputSchema: taskInputSchema,
      execute: (input) => executeCreate(ctx, "docs", input),
    }),

    create_chore: tool({
      description:
        `Open a structured "Chore" task as a GitHub issue in ${repoRef}. ` +
        'Use for dependencies, config, tooling, or cleanup work (e.g. "bump ' +
        'TypeScript to 5.5", "tighten ESLint rules", "remove dead code in ' +
        'utils/"). Labels: ["chore", "priority:<level>"]. The `requirements` ' +
        "field should describe what needs to change. Body matches the Create " +
        "Task dialog. Does NOT trigger the Kody pipeline.",
      inputSchema: taskInputSchema,
      execute: (input) => executeCreate(ctx, "chore", input),
    }),
  };
}
