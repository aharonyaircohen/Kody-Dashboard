/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Agent-creation tool for the kody-direct chat agent. Writes a
 *   `agents/<slug>.md` state repo file via the same `writeAgentFile` helper the
 *   dashboard's POST /api/kody/agents endpoint uses. An agent is a pure
 *   reusable IDENTITY: a markdown body describing intent, allowed commands,
 *   and restrictions. Agents have no schedule, no state, and no run/tick —
 *   they're agent identities referenced by other flows. Format mirrors the agent
 *   template (Agent / Allowed Commands / Restrictions).
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the agentIdentity is well-specified.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import {
  readAgentFile,
  writeAgentFile,
  isValidSlug,
} from "@dashboard/lib/agent-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Used in the commit message for traceability.
  actorLogin: string | null;
}

interface AgentInput {
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
 * Render the default agentIdentity agent body. The model fills in the variable
 * parts (purpose, allowed commands, restrictions). An agent is a
 * reusable agentIdentity — no cadence, no state, no tick.
 */
function buildAgentBody(input: AgentInput): string {
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];

  let body = "";

  body += `## Agent\n\n`;
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

export const createKodyAgentInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Human-readable agent title. Becomes the H1 of the agent file."),
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
      "One to three sentences describing the agentIdentity — what it is, what it does, " +
        "and how it should behave. No implementation details.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional shell commands the agentIdentity may run (e.g. " +
        '"`gh pr list`", "`gh run list`"). Each item becomes a bullet under "Allowed Commands".',
    ),
  extraRestrictions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional restriction bullets to append (e.g. "Never comment on PRs from this agent.").',
    ),
});

export function createAgentTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    create_kody_agent: tool({
      description:
        `Create a new Kody Agent member in ${repoRef} by committing a markdown file at ` +
        "`agents/<slug>.md` in the state repo. An agent is a pure reusable identity — a " +
        "markdown body describing intent, allowed commands, and restrictions. " +
        "Agents have no schedule, no state, and no run/tick; they're agent identities " +
        "referenced by other flows.\n\n" +
        "BEFORE CALLING: gather title, purpose, and (optionally) allowed " +
        "commands and restrictions. Ask the user clarifying questions in small " +
        "batches until the agentIdentity is well-specified — never invent behavior. " +
        "Show the proposed markdown body for approval before calling.\n\n" +
        "Returns the new file's slug, title, and html URL on success.",
      inputSchema: createKodyAgentInputSchema,
      execute: async (input) => {
        const slug = (input.slug ?? slugifyTitle(input.title)).toLowerCase();
        if (!slug || !isValidSlug(slug)) {
          return {
            error: "invalid_slug",
            message:
              "Agent slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              `Got "${slug}".`,
          };
        }

        try {
          const existing = await readAgentFile(slug);
          if (existing) {
            return {
              error: "slug_taken",
              message: `Agent member "${slug}" already exists at ${existing.htmlUrl}. Pick a different slug.`,
              existingHtmlUrl: existing.htmlUrl,
            };
          }

          const body = buildAgentBody(input);
          const message = `feat(agent): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const agentMember = await writeAgentFile({
            octokit,
            slug,
            title: input.title,
            body,
            message,
          });

          logger.info(
            { owner, repo, slug, actorLogin },
            "create_kody_agent: created agent file",
          );

          return {
            slug: agentMember.slug,
            title: agentMember.title,
            htmlUrl: agentMember.htmlUrl,
            note:
              "AgentIdentity committed at `agents/<slug>.md` in the state repo. It can " +
              "now be referenced by other flows.",
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_kody_agent failed",
          );
          return {
            error: "create_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to create agent file",
          };
        }
      },
    }),
  };
}
