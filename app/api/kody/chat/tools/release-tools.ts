/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Release-request tool for kody-direct chat agent.
 *
 * Opens a release-tracking GitHub issue and posts `@kody release` on it.
 * The repo-stored release executable reads branch policy from
 * state repo `variables.json` and handles both single-main and dev-to-main repos.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
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
  const lines: string[] = ["# Release request", ""];
  if (input.bump) lines.push(`Bump: \`${input.bump}\``);
  if (input.prefer) lines.push(`Prefer: \`${input.prefer}\``);
  if (input.dryRun) lines.push("Dry run: yes");
  lines.push("");
  lines.push("## Notes");
  lines.push(input.notes?.trim() ? input.notes.trim() : "_None provided_");
  lines.push("");
  lines.push("## Trigger");
  lines.push(`Kody will run on comment below: \`${command}\``);
  return lines.join("\n");
}

function buildCommand(input: ReleaseRequestInput): string {
  const parts: string[] = ["@kody release"];
  if (input.bump) parts.push("--bump", input.bump);
  if (input.prefer) parts.push("--prefer", input.prefer);
  if (input.dryRun) parts.push("--dry-run");
  return parts.join(" ");
}

export function createReleaseTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;

  return {
    request_release: tool({
      description:
        `Open a release-tracking GitHub issue in ${owner}/${repo} and ` +
        "trigger the branch-aware Kody release executable by posting " +
        "`@kody release`. Use when the user asks to ship, cut, publish, " +
        "or deploy a release. The executable opens the version PR to the " +
        "configured integration branch, then tags/releases after that PR " +
        "is merged. In dev/main repos it also opens the promotion PR.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Short release-issue title, e.g. "Release v1.4 - auth fixes". ' +
              'Defaults to "Release request" if omitted.',
          ),
        notes: z
          .string()
          .optional()
          .describe(
            "Optional release notes or context for the issue body. Plain markdown.",
          ),
        bump: z
          .enum(BUMPS)
          .optional()
          .describe("Version bump increment. Default is patch when omitted."),
        prefer: z
          .enum(PREFERS)
          .optional()
          .describe(
            'On release-branch collision: "ours" recreates the branch, ' +
              '"theirs" reuses the existing PR. Default refuses ambiguity.',
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Print the release plan without committing or opening a PR.",
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
                "Release issue was created but @kody trigger comment failed. " +
                `Post \`${command}\` on issue #${issue.number} manually to start it.`,
            };
          }

          logger.info(
            { owner, repo, number: issue.number, command },
            "request_release: created issue and triggered release",
          );
          return {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            command,
            triggered: true,
            note: `Release triggered via \`${command}\` on issue #${issue.number}.`,
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
