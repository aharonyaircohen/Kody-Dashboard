/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Duty-creation tool for the kody-direct chat agent. Writes a
 *   `.kody/duties/<slug>.md` file via the same `writeDutyFile` helper the
 *   dashboard's POST /api/kody/duties endpoint uses. Default body follows
 *   the report-producer template: each tick gathers inputs, composes a
 *   YAML findings report, and commits it to `.kody/reports/<slug>.md`
 *   on the dedicated state branch via `gh api PUT`. Format mirrors existing
 *   duties (Job / Allowed Commands / Restrictions / State — the `## Job`
 *   heading is parsed by the engine's job-tick executor, so its text stays
 *   literal).
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the duty is well-specified.
 *   See the "Creating Kody duties" block in AGENT_KODY.systemPrompt.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";
import {
  readDutyFile,
  writeDutyFile,
  isValidSlug,
} from "@dashboard/lib/duties-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Used in the commit message for traceability.
  actorLogin: string | null;
}

interface DutyInput {
  title: string;
  slug?: string;
  purpose: string;
  cadenceHours: number;
  inputs: string[];
  reportSchema: string;
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

function bullets(items: string[]): string {
  return items.map((s) => `- ${s.trim()}`).join("\n");
}

/**
 * Render the default report-producer duty body. The model fills in the
 * variable parts (purpose, cadence, inputs, report schema). Commands and
 * restrictions match the engine's job-tick constraints (Bash + Read +
 * `gh` only — no Write tool, so the report is committed via `gh api PUT`
 * to the state branch).
 */
function buildDutyBody(slug: string, input: DutyInput): string {
  const cadence = Math.max(1, Math.round(input.cadenceHours));
  const inputBullets =
    input.inputs.length > 0 ? bullets(input.inputs) : "- _Not specified_";
  const reportSchemaBlock = input.reportSchema.trim() || "_Not specified_";
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];

  let body = "";

  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  body += `**Cadence guard.** If \`data.lastRunISO\` is set and within the last ${cadence} hours, emit unchanged state and exit. Otherwise proceed and update \`data.lastRunISO\` to now (UTC ISO).\n\n`;

  body += `**Per tick (one action max):**\n\n`;
  body += `1. Gather inputs:\n`;
  body += `${inputBullets
    .split("\n")
    .map((l) => `   ${l}`)
    .join("\n")}\n`;
  body += `2. Compose the report findings as YAML frontmatter following this schema:\n\n`;
  body += `   \`\`\`yaml\n`;
  body += `   slug: ${slug}\n`;
  body += `   generatedAt: <ISO 8601 timestamp>\n`;
  body += `   findings:\n`;
  body += `${reportSchemaBlock
    .split("\n")
    .map((l) => `   ${l}`)
    .join("\n")}\n`;
  body += `   \`\`\`\n\n`;
  body += `3. Look up the existing report's blob SHA (skip on 404 — first run):\n`;
  body += `   \`\`\`\n`;
  body += `   EXISTING_SHA="$(gh api -X GET repos/{owner}/{repo}/contents/.kody/reports/${slug}.md \\\n`;
  body += `     -f ref=${STATE_BRANCH} \\\n`;
  body += `     --jq .sha 2>/dev/null || true)"\n`;
  body += `   \`\`\`\n`;
  body += `4. Commit the new report to the ${STATE_BRANCH} branch via the contents API (omit \`-f sha=...\` on first run):\n`;
  body += `   \`\`\`\n`;
  body += `   SHA_ARG=()\n`;
  body += `   if [ -n "$EXISTING_SHA" ]; then SHA_ARG=(-f "sha=$EXISTING_SHA"); fi\n`;
  body += `   gh api -X PUT repos/{owner}/{repo}/contents/.kody/reports/${slug}.md \\\n`;
  body += `     -f message="chore(reports): update ${slug}" \\\n`;
  body += `     -f branch=${STATE_BRANCH} \\\n`;
  body += `     -f content="$(printf '%s' "$REPORT_BODY" | base64)" \\\n`;
  body += `     "\${SHA_ARG[@]}"\n`;
  body += `   \`\`\`\n`;
  body += `5. On success, stash \`data.lastReportISO = <now>\` and \`data.findingCount = <count>\`. On non-2xx, set \`cursor: error\` and narrate the status code.\n\n`;

  body += `## Allowed Commands\n\n`;
  body += `- \`gh api\` — read + PUT contents on \`${STATE_BRANCH}:.kody/reports/${slug}.md\` only\n`;
  for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  body += `\n`;

  body += `## Restrictions\n\n`;
  body += `- Never edit, create, or delete files in the working tree. The report is committed via the GitHub contents API, not the working tree.\n`;
  body += `- Never push, never commit any branch/path other than \`${STATE_BRANCH}:.kody/reports/${slug}.md\`.\n`;
  body += `- Maximum **one** report write per tick.\n`;
  body += `- If the contents PUT fails with 409 (sha mismatch), re-read the SHA and retry once; otherwise emit \`cursor: error\` and exit.\n`;
  for (const r of extraRest) body += `- ${r.trim()}\n`;
  body += `\n`;

  body += `## State\n\n`;
  body += `- \`cursor\`: \`idle\` | \`producing\` | \`error\`\n`;
  body += `- \`data.lastRunISO\`: ISO timestamp of the last tick that ran (used by the cadence guard)\n`;
  body += `- \`data.lastReportISO\`: ISO timestamp of the last successful report write\n`;
  body += `- \`data.findingCount\`: count of findings in the last report (informational)\n`;
  body += `- \`done\`: always \`false\`\n`;

  return body;
}

export const createKodyDutyInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Human-readable duty title. Becomes the H1 of the duty file."),
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
      "One to three sentences describing what the duty scans/observes and what report it produces. " +
        "No implementation details — those go in `inputs` and `reportSchema`.",
    ),
  cadenceHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .describe(
      "Minimum hours between active ticks (cadence guard). Daily = 24, weekly = 168, hourly = 1.",
    ),
  inputs: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Concrete data sources / commands the duty runs to gather inputs. Each item is one bullet — " +
        'e.g. "`gh pr list --state open --json number,title,createdAt`" or ' +
        '"`gh api repos/{owner}/{repo}/actions/runs?status=failure&per_page=20`".',
    ),
  reportSchema: z
    .string()
    .min(1)
    .describe(
      "YAML fragment describing the `findings:` array shape that the duty will produce. Indented as it " +
        'will appear inside the YAML frontmatter — e.g. "  - id: <stable id>\\n    severity: ' +
        '<high|medium|low>\\n    title: \\"...\\"\\n    data: { ... }". Do NOT include the slug or ' +
        "generatedAt fields — those are added automatically.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional additional shell commands the duty may run beyond `gh api` (e.g. " +
        '"`gh pr list`", "`gh run list`"). Each item becomes a bullet under "Allowed Commands".',
    ),
  extraRestrictions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional additional restriction bullets to append (e.g. "Never comment on PRs from this duty.").',
    ),
});

export function createDutyTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    create_kody_duty: tool({
      description:
        `Create a new Kody Duty in ${repoRef} by committing a markdown file at ` +
        "`.kody/duties/<slug>.md`. The default template is a REPORT-PRODUCER: each " +
        "tick gathers inputs, composes a YAML findings report, and commits it to " +
        `\`${STATE_BRANCH}:.kody/reports/<slug>.md\` via \`gh api PUT\` (the engine's job-tick ` +
        "executable only has Bash + Read, so reports are committed via API, not " +
        "the working tree). The kody engine's job-scheduler ticks every duty in " +
        "`.kody/duties/` on a 5-minute cron; each duty's own cadence guard decides " +
        "whether to take action.\n\n" +
        "BEFORE CALLING: gather title, purpose, cadenceHours, inputs (data sources " +
        "as concrete `gh` commands), and reportSchema (YAML fragment for the " +
        "`findings:` array). Ask the user clarifying questions in small batches " +
        "until each field is well-specified — never invent inputs or schema. Show " +
        "the proposed markdown body for approval before calling.\n\n" +
        "Returns the new file's slug, title, and html URL on success. The duty " +
        "starts ticking on the next 5-min cron wake; no manual dispatch required.",
      inputSchema: createKodyDutyInputSchema,
      execute: async (input) => {
        const slug = (input.slug ?? slugifyTitle(input.title)).toLowerCase();
        if (!slug || !isValidSlug(slug)) {
          return {
            error: "invalid_slug",
            message:
              "Duty slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              `Got "${slug}".`,
          };
        }

        try {
          const existing = await readDutyFile(slug);
          if (existing) {
            return {
              error: "slug_taken",
              message: `Duty "${slug}" already exists at ${existing.htmlUrl}. Pick a different slug.`,
              existingHtmlUrl: existing.htmlUrl,
            };
          }

          const body = buildDutyBody(slug, input);
          const message = `feat(duties): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const duty = await writeDutyFile({
            octokit,
            slug,
            title: input.title,
            body,
            message,
          });

          logger.info(
            { owner, repo, slug, cadenceHours: input.cadenceHours, actorLogin },
            "create_kody_duty: created duty file",
          );

          return {
            slug: duty.slug,
            title: duty.title,
            htmlUrl: duty.htmlUrl,
            note:
              "Duty file committed. The kody engine's job-scheduler will pick it up on the next " +
              "5-min cron tick. The first action runs once the cadence guard allows it.",
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_kody_duty failed",
          );
          return {
            error: "create_failed",
            message:
              err instanceof Error ? err.message : "Failed to create duty file",
          };
        }
      },
    }),
  };
}
