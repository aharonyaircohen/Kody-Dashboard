/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Bug-report tool for the kody-direct chat agent.
 *
 * Creates a GitHub issue using the same structured bug-report markdown
 * the dashboard's BugReportDialog produces, scoped to the connected repo
 * and authenticated with the user's Octokit. Like the dialog, this does
 * NOT auto-trigger the Kody pipeline (no `@kody` comment).
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
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
  // doesn't supply one — every chat-filed bug should be attributable.
  actorLogin: string | null;
}

const ENVIRONMENTS = ["dev", "preview", "prod"] as const;
const REPRODUCIBILITIES = ["always", "sometimes", "rare"] as const;

interface BugReportInput {
  title: string;
  pageUrl: string;
  steps: string;
  environment?: (typeof ENVIRONMENTS)[number];
  browser?: string;
  userRole?: string;
  preconditions?: string;
  expectedResult?: string;
  actualResult?: string;
  reproducibility?: (typeof REPRODUCIBILITIES)[number];
  priority?: PriorityLevel;
  assignees?: string[];
}

function formatBugReport(input: BugReportInput): string {
  const {
    title,
    environment = "dev",
    pageUrl,
    browser,
    userRole,
    preconditions,
    steps,
    expectedResult,
    actualResult,
    reproducibility = "always",
    priority = "P2",
  } = input;

  let report = "# 🐞 Bug Report\n\n";

  report += "## 1. Title\n";
  report += `${title}\n\n`;

  report += "## 2. Environment\n";
  report += `- Environment: ${environment}\n`;
  if (pageUrl) report += `- Page URL: ${pageUrl}\n`;
  if (browser) report += `- Browser / Device: ${browser}\n`;
  if (userRole) report += `- User Role / Tenant: ${userRole}\n`;
  report += "\n";

  report += "## 3. Preconditions\n";
  report += `${preconditions || "_None specified_"}\n\n`;

  report += "## 4. Steps to Reproduce\n";
  report += `${steps || "_None specified_"}\n\n`;

  report += "## 5. Expected Result\n";
  report += `${expectedResult || "_Not specified_"}\n\n`;

  report += "## 6. Actual Result\n";
  report += `${actualResult || "_Not specified_"}\n\n`;

  report += "## 7. Priority\n";
  report += `${PRIORITY_META[priority].badge} ${priority} — ${PRIORITY_META[priority].label}\n\n`;

  report += "## 8. Reproducibility\n";
  report += `${reproducibility}\n`;

  return report;
}

export function createBugTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;

  return {
    report_bug: tool({
      description:
        `Open a structured bug report as a GitHub issue in ${owner}/${repo}. ` +
        'Use this when the user describes a bug they want filed (e.g. "open a bug ' +
        'for X", "report this", "file a ticket"). The issue is created under the ' +
        'user\'s GitHub identity with labels ["bug", "priority:<level>"], using ' +
        "the same markdown template as the dashboard bug-report form. Does NOT " +
        "trigger the Kody pipeline — the user can run `@kody` themselves later. " +
        "Before calling, gather at minimum: a short title, the page URL where the " +
        "bug occurred, and clear steps to reproduce. Ask the user for any missing " +
        "critical fields rather than inventing them.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .describe(
            'Short bug title, e.g. "[Tasks] Edit dialog crashes on empty priority"',
          ),
        pageUrl: z
          .string()
          .url()
          .describe("URL of the page where the bug occurred (required)"),
        steps: z
          .string()
          .min(1)
          .describe("Steps to reproduce, ideally numbered 1./2./3. (required)"),
        environment: z
          .enum(ENVIRONMENTS)
          .optional()
          .describe('Where the bug occurred. Defaults to "dev".'),
        browser: z
          .string()
          .optional()
          .describe(
            'Browser / device, e.g. "Chrome", "Mobile Safari (iPhone)"',
          ),
        userRole: z
          .string()
          .optional()
          .describe('User role / tenant, e.g. "Admin", "Student", "Guest"'),
        preconditions: z
          .string()
          .optional()
          .describe("What must exist for the bug to occur"),
        expectedResult: z.string().optional().describe("What should happen"),
        actualResult: z.string().optional().describe("What actually happened"),
        reproducibility: z
          .enum(REPRODUCIBILITIES)
          .optional()
          .describe('How reliably the bug reproduces. Defaults to "always".'),
        priority: z
          .enum(PRIORITY_LEVELS)
          .optional()
          .describe(
            "Priority level. P0=Critical, P1=High, P2=Medium (default), P3=Low.",
          ),
        assignees: z
          .array(z.string())
          .optional()
          .describe(
            "GitHub logins to assign — only set when the user asks for it.",
          ),
      }),
      execute: async (input) => {
        const priority: PriorityLevel = input.priority ?? "P2";
        const body = formatBugReport({ ...input, priority });
        const labels = Array.from(new Set(["bug", `priority:${priority}`]));

        // Default assignee to the chat actor when the model didn't supply
        // one, mirroring the dashboard's bug-report fallback so every
        // chat-filed bug has an owner on the board.
        const resolvedAssignees =
          input.assignees && input.assignees.length > 0
            ? input.assignees
            : actorLogin
              ? [actorLogin]
              : undefined;

        try {
          const { data } = await octokit.rest.issues.create({
            owner,
            repo,
            title: input.title,
            body,
            labels,
            assignees: resolvedAssignees,
          });
          logger.info(
            { owner, repo, number: data.number, priority },
            "report_bug: created issue",
          );
          return {
            number: data.number,
            title: data.title,
            url: data.html_url,
            labels,
            assignees:
              data.assignees?.map((a) => a?.login).filter(Boolean) ?? [],
            priority,
            note: "Bug filed. Kody pipeline NOT auto-triggered — comment `@kody` on the issue to run it.",
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, title: input.title },
            "report_bug failed",
          );
          return {
            error:
              err instanceof Error ? err.message : "Failed to create bug issue",
          };
        }
      },
    }),
  };
}
