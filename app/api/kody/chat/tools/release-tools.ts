/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Release-request tool for the kody-direct chat agent.
 *
 * Opens a release-tracking GitHub issue and posts a `@kody <mode>` comment
 * on it so the Kody engine kicks off the release. Mirrors the bug-tools
 * pattern (issue created under the user's GitHub identity), but unlike
 * `report_bug` this DOES auto-trigger the pipeline — that's the point.
 *
 * Supported modes (engine executables, see kody2/src/dispatch.ts):
 *   release          — full orchestrator: prepare → publish → deploy
 *   release-prepare  — just bump version files, open the release PR
 *   release-publish  — publish a previously-prepared release
 *   release-deploy   — deploy a previously-published release
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

const RELEASE_MODES = [
  "release",
  "release-prepare",
  "release-publish",
  "release-deploy",
] as const;
const BUMPS = ["patch", "minor", "major"] as const;
const PREFERS = ["ours", "theirs"] as const;

type ReleaseMode = (typeof RELEASE_MODES)[number];
type Bump = (typeof BUMPS)[number];
type Prefer = (typeof PREFERS)[number];

interface ReleaseRequestInput {
  title?: string;
  notes?: string;
  mode?: ReleaseMode;
  bump?: Bump;
  prefer?: Prefer;
  dryRun?: boolean;
}

function buildIssueBody(input: ReleaseRequestInput, command: string): string {
  const lines: string[] = ["# 🚀 Release request", ""];
  lines.push("## Mode");
  lines.push(`\`${input.mode ?? "release"}\``);
  if (input.bump) lines.push(`\nBump: \`${input.bump}\``);
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
  const parts: string[] = [`@kody ${input.mode ?? "release"}`];
  // Only `release-prepare` accepts bump/prefer/dry-run flags. The
  // orchestrator and publish/deploy profiles ignore them — see
  // kody2/src/executables/*/profile.json.
  if ((input.mode ?? "release") === "release-prepare") {
    if (input.bump) parts.push(input.bump);
    if (input.prefer) parts.push(`--prefer ${input.prefer}`);
    if (input.dryRun) parts.push("--dry-run");
  }
  return parts.join(" ");
}

export function createReleaseTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;

  return {
    request_release: tool({
      description:
        `Open a release-tracking GitHub issue in ${owner}/${repo} and trigger the ` +
        "Kody release pipeline by posting `@kody <mode>` on it. Use this when the " +
        'user asks to "ship a release", "cut a release", "publish version X", ' +
        '"prepare a release", "deploy the release", etc. The issue is created ' +
        'under the user\'s GitHub identity with labels ["release"]. Unlike ' +
        "`report_bug`, this DOES auto-trigger the pipeline — confirm intent with " +
        "the user before calling if the conversation is ambiguous. Pick `mode` " +
        'based on what the user asked for: "release" (full orchestrator: prepare ' +
        '→ publish → deploy) is the default; use "release-prepare" for just the ' +
        'PR (supports bump / prefer / dry-run), "release-publish" or ' +
        '"release-deploy" for resuming a previously-prepared release.',
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
        mode: z
          .enum(RELEASE_MODES)
          .optional()
          .describe(
            'Which release executable to dispatch. Defaults to "release" ' +
              "(full orchestrator: prepare → publish → deploy).",
          ),
        bump: z
          .enum(BUMPS)
          .optional()
          .describe(
            "Version bump for `release-prepare`. Ignored by other modes. " +
              "Engine default is patch when omitted.",
          ),
        prefer: z
          .enum(PREFERS)
          .optional()
          .describe(
            'On `release-prepare` branch collision: "ours" force-pushes, ' +
              '"theirs" reuses the existing PR. Default (omit) refuses non-ff. ' +
              "Ignored by other modes.",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "For `release-prepare`: print the plan without committing or " +
              "opening a PR. Ignored by other modes.",
          ),
      }),
      execute: async (input) => {
        const mode: ReleaseMode = input.mode ?? "release";
        const command = buildCommand({ ...input, mode });
        const title = input.title?.trim() || `Release request (${mode})`;
        const body = buildIssueBody({ ...input, mode }, command);

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
              mode,
              command,
              triggered: false,
              note:
                "Release issue was created but the @kody trigger comment failed. " +
                `Post \`${command}\` on issue #${issue.number} manually to start the pipeline.`,
            };
          }

          logger.info(
            { owner, repo, number: issue.number, mode, command },
            "request_release: created issue and triggered pipeline",
          );
          return {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            mode,
            command,
            triggered: true,
            note: `Release pipeline triggered via \`${command}\` on issue #${issue.number}.`,
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, title, mode },
            "request_release failed",
          );
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
