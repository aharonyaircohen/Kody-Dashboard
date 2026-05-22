/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Worker-creation tool for the kody-direct chat agent. Writes a
 *   `.kody/workers/<slug>.md` file via the same `writeWorkerFile` helper the
 *   dashboard's POST /api/kody/workers endpoint uses. A worker is a pure
 *   reusable PERSONA: a markdown body describing intent, allowed commands,
 *   and restrictions. Workers have no schedule, no state, and no run/tick —
 *   they're personas referenced by other flows. Format mirrors the worker
 *   template (Worker / Allowed Commands / Restrictions).
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the persona is well-specified.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import {
  readWorkerFile,
  writeWorkerFile,
  isValidSlug,
} from "@dashboard/lib/workers-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Used in the commit message for traceability.
  actorLogin: string | null;
}

interface WorkerInput {
  title: string;
  slug?: string;
  purpose: string;
  extraAllowedCommands?: string[];
  extraRestrictions?: string[];
}

function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

/**
 * Render the default persona worker body. The model fills in the variable
 * parts (purpose, allowed commands, restrictions). A worker is a reusable
 * persona — no cadence, no state, no tick.
 */
function buildWorkerBody(input: WorkerInput): string {
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];

  let body = "";

  body += `## Worker\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  body += `## Allowed Commands\n\n`;
  if (extraCmds.length > 0) {
    for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  } else {
    body += `- _Not specified_\n`;
  }
  body += `\n`;

  body += `## Restrictions\n\n`;
  if (extraRest.length > 0) {
    for (const r of extraRest) body += `- ${r.trim()}\n`;
  } else {
    body += `- _Not specified_\n`;
  }
  body += `\n`;

  return body;
}

export const createKodyWorkerInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Human-readable worker title. Becomes the H1 of the worker file."),
  slug: z
    .string()
    .optional()
    .describe(
      "Optional file slug (lowercase letters, digits, dashes, underscores; max 64 chars). " +
        "If omitted, derived from the title.",
    ),
  purpose: z
    .string()
    .min(1)
    .describe(
      "One to three sentences describing the worker persona — what it is, what it does, " +
        "and how it should behave. No implementation details.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional shell commands the worker persona may run (e.g. " +
        '"`gh pr list`", "`gh run list`"). Each item becomes a bullet under "Allowed Commands".',
    ),
  extraRestrictions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional restriction bullets to append (e.g. "Never comment on PRs from this worker.").',
    ),
});

export function createWorkerTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    create_kody_worker: tool({
      description:
        `Create a new Kody Worker in ${repoRef} by committing a markdown file at ` +
        "`.kody/workers/<slug>.md`. A worker is a pure reusable PERSONA — a " +
        "markdown body describing intent, allowed commands, and restrictions. " +
        "Workers have no schedule, no state, and no run/tick; they're personas " +
        "referenced by other flows.\n\n" +
        "BEFORE CALLING: gather title, purpose, and (optionally) allowed " +
        "commands and restrictions. Ask the user clarifying questions in small " +
        "batches until the persona is well-specified — never invent behavior. " +
        "Show the proposed markdown body for approval before calling.\n\n" +
        "Returns the new file's slug, title, and html URL on success.",
      inputSchema: createKodyWorkerInputSchema,
      execute: async (input) => {
        const slug = (input.slug ?? slugifyTitle(input.title)).toLowerCase();
        if (!slug || !isValidSlug(slug)) {
          return {
            error: "invalid_slug",
            message:
              "Worker slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              `Got "${slug}".`,
          };
        }

        try {
          const existing = await readWorkerFile(slug);
          if (existing) {
            return {
              error: "slug_taken",
              message: `Worker "${slug}" already exists at ${existing.htmlUrl}. Pick a different slug.`,
              existingHtmlUrl: existing.htmlUrl,
            };
          }

          const body = buildWorkerBody(input);
          const message = `feat(workers): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const worker = await writeWorkerFile({
            octokit,
            slug,
            title: input.title,
            body,
            message,
          });

          logger.info(
            { owner, repo, slug, actorLogin },
            "create_kody_worker: created worker file",
          );

          return {
            slug: worker.slug,
            title: worker.title,
            htmlUrl: worker.htmlUrl,
            note:
              "Worker persona committed at `.kody/workers/<slug>.md`. It can " +
              "now be referenced by other flows.",
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_kody_worker failed",
          );
          return {
            error: "create_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to create worker file",
          };
        }
      },
    }),
  };
}
