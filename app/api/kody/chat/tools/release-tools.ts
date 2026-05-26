/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Release-request tool for the kody-direct chat agent.
 *
 * Opens a release-tracking GitHub issue and posts `@kody release` on it so the
 * Kody engine runs the FULL release orchestrator (prepare → wait CI → merge →
 * publish → deploy → notify). Mirrors the bug-tools pattern (issue created
 * under the user's GitHub identity), but unlike `report_bug` this DOES
 * auto-trigger the pipeline — that's the point.
 *
 * Only the full `release` flow is exposed on purpose: triggering a partial
 * step (release-publish / release-deploy on its own) leaves the release
 * half-done (e.g. published but no dev→main promotion PR). If you genuinely
 * need to resume a single step, comment `@kody release-<step>` on the issue
 * by hand. See kody2/src/dispatch.ts + the kody2 release executables.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Auto-assigned to the release-tracking issue
  // so every release on the board has a clear owner.
  actorLogin: string | null;
}

const BUMPS = ["patch", "minor", "major"] as const;
const PREFERS = ["ours", "theirs"] as const;

type Bump = (typeof BUMPS)[number];
type Prefer = (typeof PREFERS)[number];

interface ReleaseRequestInput {
  title?: string;
  notes?: string;
  bump?: Bump;
  prefer?: Prefer;
  dryRun?: boolean;
}

function buildIssueBody(input: ReleaseRequestInput, command: string): string {
  const lines: string[] = ["# 🚀 Release request", ""];
  if (input.bump) lines.push(`Bump: \`${input.bump}\``);
  if (input.prefer) lines.push(`Prefer: \`${input.prefer}\``);
  if (input.dryRun) lines.push("Dry run: yes");
  lines.push("");
  lines.push("## Notes");
  lines.push(input.notes?.trim() ? input.notes.trim() : "_None provided_");
  lines.push("");
  lines.push("## Trigger");
  lines.push(`Kody will run on the comment below: \`${command}\``);
  return lines.join("\n");
}

function buildCommand(input: ReleaseRequestInput): string {
  // Always the full orchestrator. It accepts bump / prefer / dry-run
  // (see kody2/src/executables/release/profile.json) and threads them
  // through to the prepare step internally.
  const parts: string[] = ["@kody release"];
  if (input.bump) parts.push(input.bump);
  if (input.prefer) parts.push(`--prefer ${input.prefer}`);
  if (input.dryRun) parts.push("--dry-run");
  return parts.join(" ");
}

export function createReleaseTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;

  return {
    request_release: tool({
      description:
        `Open a release-tracking GitHub issue in ${owner}/${repo} and trigger the ` +
        "FULL Kody release by posting `@kody release` on it — the orchestrator " +
        "runs prepare → wait CI → merge → publish → deploy → notify end-to-end " +
        '(including the dev→main promotion PR). Use this when the user asks to ' +
        '"ship a release", "cut a release", "publish version X", "deploy the ' +
        "release\", etc. The issue is created under the user's GitHub identity " +
        'with labels ["release"]. Unlike `report_bug`, this DOES auto-trigger ' +
        "the pipeline — confirm intent with the user before calling if the " +
        "conversation is ambiguous.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Short release-issue title, e.g. "Release v1.4 — auth + billing fixes". ' +
              'Defaults to a generic "Release request" if omitted.',
          ),
        notes: z
          .string()
          .optional()
          .describe(
            "Optional release notes / context to include in the issue body " +
              "(highlights, intent, scope). Plain markdown.",
          ),
        bump: z
          .enum(BUMPS)
          .optional()
          .describe(
            "Version bump increment. Engine default is patch when omitted.",
          ),
        prefer: z
          .enum(PREFERS)
          .optional()
          .describe(
            'On release-branch collision: "ours" force-pushes, "theirs" reuses ' +
              "the existing PR. Default (omit) refuses non-ff.",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Print the plan without committing or opening a PR.",
          ),
      }),
      execute: async (input) => {
        const command = buildCommand(input);
        const title = input.title?.trim() || "Release request";
        const body = buildIssueBody(input, command);

        try {
          const { data: issue } = await octokit.rest.issues.create({
            owner,
            repo,
            title,
            body,
            labels: ["release"],
            assignees: actorLogin ? [actorLogin] : undefined,
          });

          try {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: issue.number,
              body: command,
            });
          } catch (err) {
            logger.warn(
              { err, owner, repo, number: issue.number, command },
              "request_release: issue created but trigger comment failed",
            );
            return {
              number: issue.number,
              title: issue.title,
              url: issue.html_url,
              command,
              triggered: false,
              note:
                "Release issue was created but the @kody trigger comment failed. " +
                `Post \`${command}\` on issue #${issue.number} manually to start the pipeline.`,
            };
          }

          logger.info(
            { owner, repo, number: issue.number, command },
            "request_release: created issue and triggered pipeline",
          );
          return {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            command,
            triggered: true,
            note: `Release pipeline triggered via \`${command}\` on issue #${issue.number}.`,
          };
        } catch (err) {
          logger.warn({ err, owner, repo, title }, "request_release failed");
          return {
            error:
              err instanceof Error
                ? err.message
                : "Failed to create release issue",
          };
        }
      },
    }),
  };
}
