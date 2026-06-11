/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Duty-creation tool for the kody-direct chat agent. Writes a
 *   `.kody/duties/<slug>.md` file via the same `writeDutyFile` helper the
 *   dashboard's POST /api/kody/duties endpoint uses. Default body follows
 *   the report-producer template: each scheduled run gathers inputs,
 *   composes a YAML findings report, and commits it to
 *   `.kody/reports/<slug>.md` on the dedicated state branch via `gh api PUT`.
 *   Format mirrors the duty contract (Job / Allowed Commands / Restrictions —
 *   the `## Job` heading is parsed by the engine's job-tick executor, so its
 *   text stays literal).
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the duty is well-specified.
 *   It should call read_duty_creation_guide first.
 */
import { readFile } from "fs/promises";
import path from "path";
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
import {
  DUTY_STAGE_TEMPLATE_SLUGS,
  type DutyStageTemplateSlug,
} from "@dashboard/lib/duties/stage-templates";

const DUTY_SCHEDULE_VALUES = [
  "15m",
  "30m",
  "1h",
  "2h",
  "6h",
  "12h",
  "1d",
  "3d",
  "7d",
  "manual",
] as const;

type DutyScheduleToken = (typeof DUTY_SCHEDULE_VALUES)[number];

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
  action?: string;
  executable?: string;
  staff: string;
  schedule: DutyScheduleToken;
  stage: DutyStageTemplateSlug;
  purpose: string;
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

async function readDutyGuide(): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "docs/duties.md"), "utf8");
  } catch {
    return [
      "# Kody duties",
      "",
      "- Kody can create duties with `create_kody_duty`.",
      "- Duties live at `.kody/duties/<slug>.md`.",
      "- A duty owns public action, purpose, cadence, staff, progress type, and safety rules.",
      "- Put staff persona in `.kody/staff/<slug>.md`.",
      "- Put reusable action logic in `.kody/executables/<slug>/`.",
      "- Do not put raw state keys in the duty body; use `stage:`.",
    ].join("\n");
  }
}

/**
 * Render the default report-producer duty body. The model fills in the
 * variable parts (purpose, inputs, report schema). Cadence, staff, and
 * progress live in frontmatter so the operator does not have to author raw
 * runtime state rules.
 */
function buildDutyBody(slug: string, input: DutyInput): string {
  const inputBullets =
    input.inputs.length > 0 ? bullets(input.inputs) : "- _Not specified_";
  const reportSchemaBlock = input.reportSchema.trim() || "_Not specified_";
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];

  let body = "";

  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  body += `**Per scheduled run:**\n\n`;
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
  body += `5. On success, stop. On non-2xx, report the status code and stop.\n\n`;

  body += `## Allowed Commands\n\n`;
  body += `- \`gh api\` — read + PUT contents on \`${STATE_BRANCH}:.kody/reports/${slug}.md\` only\n`;
  for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  body += `\n`;

  body += `## Restrictions\n\n`;
  body += `- Never edit, create, or delete files in the working tree. The report is committed via the GitHub contents API, not the working tree.\n`;
  body += `- Never push, never commit any branch/path other than \`${STATE_BRANCH}:.kody/reports/${slug}.md\`.\n`;
  body += `- Maximum **one** report write per tick.\n`;
  body += `- If the contents PUT fails with 409 (sha mismatch), re-read the SHA and retry once; otherwise report the error and exit.\n`;
  for (const r of extraRest) body += `- ${r.trim()}\n`;

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
  action: z
    .string()
    .optional()
    .describe(
      "Optional public @kody action name. If omitted, defaults to the duty slug.",
    ),
  executable: z
    .string()
    .optional()
    .describe(
      "Optional implementation executable slug. Omit for normal markdown duties that the built-in duty runner should execute.",
    ),
  staff: z
    .string()
    .min(1)
    .describe(
      "Staff persona slug that will run this duty, e.g. `qa` or `cto`. A duty without staff should not auto-run.",
    ),
  schedule: z
    .enum(DUTY_SCHEDULE_VALUES)
    .default("1d")
    .describe(
      "Frontmatter cadence for `every:`. Use `manual` for run-button only, or values like `1h`, `1d`, `7d` for auto-run.",
    ),
  stage: z
    .enum(DUTY_STAGE_TEMPLATE_SLUGS)
    .default("report-refresh")
    .describe(
      "Progress type for `stage:`. For this report-producing tool, `report-refresh` is usually correct.",
    ),
  purpose: z
    .string()
    .min(1)
    .describe(
      "One to three sentences describing what the duty scans/observes and what report it produces. " +
        "No implementation details — those go in `inputs` and `reportSchema`.",
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
    read_duty_creation_guide: tool({
      description:
        "Read the required guide for creating Kody duties. Call this before designing or using create_kody_duty. Also confirms Kody can create duties through chat.",
      inputSchema: z.object({}),
      execute: async () => ({
        canCreateDuty: true,
        creationTool: "create_kody_duty",
        guide: await readDutyGuide(),
      }),
    }),

    create_kody_duty: tool({
      description:
        `Create a new Kody Duty in ${repoRef}. Before calling it, call read_duty_creation_guide and follow that guide. Commits a markdown file at ` +
        "`.kody/duties/<slug>.md`. The default template is a REPORT-PRODUCER: each " +
        "scheduled run gathers inputs, composes a YAML findings report, and commits it to " +
        `\`${STATE_BRANCH}:.kody/reports/<slug>.md\` via \`gh api PUT\` (the engine's job-tick ` +
        "executable only has Bash + Read, so reports are committed via API, not " +
        "the working tree). The kody engine's job-scheduler ticks every duty in " +
        "`.kody/duties/`; the duty's `every:` frontmatter decides how often it may run.\n\n" +
        "BEFORE CALLING: gather title, purpose, staff, schedule, stage, inputs (data sources " +
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
          const action = slugifyTitle(input.action ?? slug);
          if (!isValidSlug(action)) {
            return {
              error: "invalid_action",
              message:
                "Duty action must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${action}".`,
            };
          }
          const executable = input.executable?.trim() || null;
          if (executable && !isValidSlug(executable)) {
            return {
              error: "invalid_executable",
              message:
                "Executable slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${executable}".`,
            };
          }
          const message = `feat(duties): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const duty = await writeDutyFile({
            octokit,
            slug,
            title: input.title,
            body,
            schedule: input.schedule,
            staff: input.staff,
            stage: input.stage,
            action,
            executable,
            message,
          });

          logger.info(
            {
              owner,
              repo,
              slug,
              action,
              executable,
              schedule: input.schedule,
              staff: input.staff,
              stage: input.stage,
              actorLogin,
            },
            "create_kody_duty: created duty file",
          );

          return {
            slug: duty.slug,
            title: duty.title,
            htmlUrl: duty.htmlUrl,
            note:
              "Duty file committed. The kody engine's job-scheduler will pick it up on the next " +
              "5-min cron tick. The `every:` frontmatter controls how often it may run.",
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
