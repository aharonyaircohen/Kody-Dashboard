/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Duty-creation tool for the kody-direct chat agent. Writes a
 *   `.kody/duties/<slug>/` folder via the same `writeDutyFile` helper the
 *   dashboard's POST /api/kody/duties endpoint uses. Metadata lands in
 *   `profile.json`; human-readable purpose and limits land in `duty.md`.
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
  runner: string;
  reviewer?: string;
  schedule: DutyScheduleToken;
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
      "- Duties live at `.kody/duties/<slug>/profile.json` plus `duty.md`.",
      "- A duty owns public action, purpose, cadence, runner, reviewer, output, and safety rules.",
      "- Put staff persona in `.kody/staff/<slug>.md`.",
      "- Put reusable action logic in `.kody/executables/<slug>/`.",
      "- Do not put metadata or raw state keys in `duty.md`; runtime state belongs to the engine.",
    ].join("\n");
  }
}

/**
 * Render the default report-producer duty body. The model fills in the
 * variable parts (purpose, inputs, report schema). Cadence and runner live in
 * profile.json so the operator does not have to author raw runtime state rules.
 */
function buildDutyBody(slug: string, input: DutyInput): string {
  const inputBullets =
    input.inputs.length > 0 ? bullets(input.inputs) : "- _Not specified_";
  const reportSchemaBlock = input.reportSchema.trim() || "_Not specified_";
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];
  const executable = input.executable?.trim();

  let body = "";

  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  if (executable) {
    body += `## Executable\n\n`;
    body += `Run the \`${executable}\` executable. Its skills and scripts own the implementation details.\n\n`;
  }

  body += `## Inputs\n\n`;
  body += `${inputBullets}\n\n`;

  body += `## Output\n\n`;
  body += `Refresh \`${STATE_BRANCH}:.kody/reports/${slug}.md\` with a report that follows this findings shape:\n\n`;
  body += `\`\`\`yaml\n`;
  body += `slug: ${slug}\n`;
  body += `generatedAt: <ISO 8601 timestamp>\n`;
  body += `findings:\n`;
  body += `${reportSchemaBlock}\n`;
  body += `\`\`\`\n\n`;

  body += `## Allowed Commands\n\n`;
  if (executable) {
    body += `- Run the \`${executable}\` executable.\n`;
  } else {
    body += `- Use only the minimum read/write tools needed to refresh \`${STATE_BRANCH}:.kody/reports/${slug}.md\`.\n`;
  }
  for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  body += `\n`;

  body += `## Restrictions\n\n`;
  body += `- Never edit source files from this duty.\n`;
  body += `- Never write outside \`${STATE_BRANCH}:.kody/reports/${slug}.md\` unless the user changes the duty contract.\n`;
  body += `- Maximum one report refresh per tick.\n`;
  for (const r of extraRest) body += `- ${r.trim()}\n`;

  return body;
}

export const createKodyDutyInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Human-readable duty title. Becomes the H1 of duty.md."),
  slug: z
    .string()
    .optional()
    .describe(
      "Optional duty slug (lowercase letters, digits, dashes, underscores; max 64 chars). " +
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
      "Optional implementation executable slug. Omit for normal folder duties that the built-in duty runner should execute.",
    ),
  runner: z
    .string()
    .min(1)
    .describe(
      "Staff persona slug that will run this duty, e.g. `qa` or `cto`. A duty without runner should not auto-run.",
    ),
  reviewer: z
    .string()
    .optional()
    .describe(
      "Optional staff persona slug responsible for reviewing or handling the duty output.",
    ),
  schedule: z
    .enum(DUTY_SCHEDULE_VALUES)
    .default("1d")
    .describe(
      "Duty profile cadence for `every`. Use `manual` for run-button only, or values like `1h`, `1d`, `7d` for auto-run.",
    ),
  purpose: z
    .string()
    .min(1)
    .describe(
      "One to three sentences describing what the duty scans/observes and what report it produces. " +
        "No implementation details; those go in an executable skill/script when needed.",
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
        'will appear inside the report YAML frontmatter — e.g. "  - id: <stable id>\\n    severity: ' +
        '<high|medium|low>\\n    title: \\"...\\"\\n    data: { ... }". Do NOT include the slug or ' +
        "generatedAt fields — those are added automatically.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional additional allowed commands for the duty body (e.g. " +
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
        `Create a new Kody Duty in ${repoRef}. Before calling it, call read_duty_creation_guide and follow that guide. Commits a duty folder at ` +
        "`.kody/duties/<slug>/` (`profile.json` + `duty.md`). The default template is a REPORT-PRODUCER: each " +
        "scheduled run gathers inputs, composes a YAML findings report, and refreshes " +
        `\`${STATE_BRANCH}:.kody/reports/<slug>.md\`. The kody engine's duty-scheduler ticks every duty folder in ` +
        "`.kody/duties/`; the duty profile's `every` value decides how often it may run.\n\n" +
        "BEFORE CALLING: gather title, purpose, runner, reviewer, schedule, output path, inputs (data sources " +
        "as concrete `gh` commands), and reportSchema when this is a report duty (YAML fragment for the " +
        "`findings:` array). Ask the user clarifying questions in small batches " +
        "until each field is well-specified — never invent inputs or schema. Show " +
        "the proposed profile JSON and markdown body for approval before calling.\n\n" +
        "Returns the new duty slug, title, and html URL on success. The duty " +
        "starts ticking on the next scheduler wake; no manual dispatch required.",
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
            runner: input.runner,
            reviewer: input.reviewer?.trim().replace(/^@/, "") || null,
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
              runner: input.runner,
              actorLogin,
            },
            "create_kody_duty: created duty folder",
          );

          return {
            slug: duty.slug,
            title: duty.title,
            htmlUrl: duty.htmlUrl,
            note:
              "Duty folder committed. The kody engine's duty-scheduler will pick it up on the next " +
              "scheduler wake. The profile `every` value controls how often it may run.",
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_kody_duty failed",
          );
          return {
            error: "create_failed",
            message:
              err instanceof Error ? err.message : "Failed to create duty folder",
          };
        }
      },
    }),
  };
}
