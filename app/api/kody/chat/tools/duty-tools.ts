/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Duty create-or-update tool for the kody-direct chat agent.
 *   Writes a `.kody/duties/<slug>/` folder via the same `writeDutyFile`
 *   helper the dashboard's POST /api/kody/duties endpoint uses. Metadata
 *   lands in `profile.json`; human-readable purpose and limits land in
 *   `duty.md`. Resolves the slug from the existing folder when present
 *   (update) and from the title otherwise (create) — same tool, two
 *   modes. Mirrors the read-merge semantics of PATCH
 *   `app/api/kody/duties/[slug]/route.ts`: omitted fields are preserved,
 *   only the `body` string explicitly overwrites the markdown content.
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the duty is well-specified.
 *   It should call read_duty_creation_guide first. For updates, prefer
 *   `read_duty` first to surface the current profile + body before
 *   patching.
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
  title?: string;
  slug?: string;
  action?: string;
  executable?: string;
  executables?: string[];
  staff?: string;
  /**
   * @deprecated Alias for `staff` — kept for callers that still pass the
   * old name. If both are provided, `staff` wins.
   */
  runner?: string;
  reviewer?: string;
  schedule?: DutyScheduleToken;
  purpose: string;
  inputs: string[];
  reportSchema: string;
  extraAllowedCommands?: string[];
  extraRestrictions?: string[];
  /**
   * Output mode for the duty body. `report` (default) bakes in the
   * report-producer template (Refresh `.kody/reports/...` + report-specific
   * restrictions); `run` produces a generic Run-style body with NO report
   * markers — the engine appears to read body markers to route duties
   * (REPORT vs Run), so multi-executable / dispatch-style duties MUST use
   * `run` or the engine will dispatch to the report-writer path.
   * `run` also relaxes the create-required fields: `inputs` and
   * `reportSchema` become optional.
   */
  output?: "run" | "report";
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
      "- Kody can create or update duties with `create_or_update_kody_duty`.",
      "- Duties live at `.kody/duties/<slug>/profile.json` plus `duty.md`.",
      "- A duty owns public action, purpose, cadence, runner, reviewer, output, and safety rules.",
      "- Put staff persona in `.kody/staff/<slug>.md`.",
      "- Put reusable action logic in `.kody/executables/<slug>/`.",
      "- Do not put metadata or raw state keys in `duty.md`; runtime state belongs to the engine.",
    ].join("\n");
  }
}

/**
 * Resolve the output mode for a duty. The explicit `output` parameter
 * wins; otherwise we auto-detect from the executables list — multi-
 * executable (2+) duties are almost always Run-style (the engine reads
 * body markers to route duties, and Report-style bodies on multi-run
 * duties dispatch to the wrong path). Single-executable and zero-
 * executable duties default to Report-style for backwards compatibility.
 */
function resolveOutput(input: {
  output?: "run" | "report";
  executables?: string[];
}): "run" | "report" {
  if (input.output === "run" || input.output === "report") return input.output;
  if (input.executables && input.executables.length > 1) return "run";
  return "report";
}

/**
 * Render the duty body. Dispatches to Run-style or Report-style based on
 * the resolved output mode. Run-style is for duties that perform work
 * directly (no findings report); Report-style is for duties that
 * gather inputs and refresh a `.kody/reports/<slug>.md` file.
 */
function buildDutyBody(slug: string, input: DutyInput): string {
  const output = resolveOutput(input);
  return output === "run"
    ? buildRunStyleBody(slug, input)
    : buildReportStyleBody(slug, input);
}

/**
 * Run-style duty body — for duties that perform work directly without
 * producing a YAML findings report. NO report markers (no `## Output`,
 * no "Refresh .kody/reports/...", no "Maximum one report refresh per
 * tick" restriction). The engine appears to read body markers to route
 * duties; a Run-style body here is what gets dispatched as a normal
 * task-job run, NOT to the report-writer.
 */
function buildRunStyleBody(slug: string, input: DutyInput): string {
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];
  const executables = canonicalizeExecutables(input);

  let body = "";
  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  if (executables.length === 1) {
    body += `## Executable\n\n`;
    body += `Run the \`${executables[0]}\` executable. Its skills and scripts own the implementation details.\n\n`;
  } else if (executables.length > 1) {
    body += `## Executables\n\n`;
    body += `This duty runs the following executables in order:\n\n`;
    for (const exe of executables) {
      body += `- \`${exe}\`\n`;
    }
    body += `\nEach executable's skills and scripts own its implementation details.\n\n`;
  }

  body += `## Allowed Commands\n\n`;
  if (executables.length === 1) {
    body += `- Run the \`${executables[0]}\` executable.\n`;
  } else if (executables.length > 1) {
    for (const exe of executables) {
      body += `- Run the \`${exe}\` executable.\n`;
    }
  } else {
    body += `- Use only the tools needed to complete the duty's purpose.\n`;
  }
  for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  body += `\n`;

  body += `## Restrictions\n\n`;
  body += `- Stay within the duty's purpose and the per-executable rules.\n`;
  body += `- Do not perform actions outside the contract defined by this duty.\n`;
  for (const r of extraRest) body += `- ${r.trim()}\n`;

  return body;
}

/**
 * Report-style duty body — the default. Includes `## Output` with the
 * `.kody/reports/<slug>.md` refresh contract and the "Maximum one report
 * refresh per tick" restriction. The engine reads these markers to
 * dispatch to the report-writer path. Use this for any duty whose
 * primary artifact is a YAML findings report on the state branch.
 */
function buildReportStyleBody(slug: string, input: DutyInput): string {
  const inputBullets =
    input.inputs.length > 0 ? bullets(input.inputs) : "- _Not specified_";
  const reportSchemaBlock = input.reportSchema.trim() || "_Not specified_";
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];
  const executables = canonicalizeExecutables(input);

  let body = "";
  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  if (executables.length === 1) {
    body += `## Executable\n\n`;
    body += `Run the \`${executables[0]}\` executable. Its skills and scripts own the implementation details.\n\n`;
  } else if (executables.length > 1) {
    body += `## Executables\n\n`;
    body += `This duty runs the following executables in order:\n\n`;
    for (const exe of executables) {
      body += `- \`${exe}\`\n`;
    }
    body += `\nEach executable's skills and scripts own its implementation details.\n\n`;
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
  if (executables.length === 1) {
    body += `- Run the \`${executables[0]}\` executable.\n`;
  } else if (executables.length > 1) {
    for (const exe of executables) {
      body += `- Run the \`${exe}\` executable.\n`;
    }
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

/**
 * Canonicalize the executables list: prefer the explicit `executables`
 * array, fall back to the singular `executable` if the list is missing
 * or empty. Empty result means the duty has no executables.
 */
function canonicalizeExecutables(input: DutyInput): string[] {
  if (input.executables && input.executables.length > 0) {
    return input.executables
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }
  const singular = input.executable?.trim();
  return singular ? [singular] : [];
}

export const createOrUpdateKodyDutyInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Human-readable duty title (becomes the H1 of duty.md). " +
        "Required when CREATING a new duty; omitted fields preserve the existing title on update.",
    ),
  slug: z
    .string()
    .optional()
    .describe(
      "Duty slug (lowercase letters, digits, dashes, underscores; max 64 chars). " +
        "Required on UPDATE — pass the existing slug to identify which duty to change. " +
        "On create, if omitted, derived from the title.",
    ),
  action: z
    .string()
    .optional()
    .describe(
      "Public @kody action name. Omit to preserve the existing action on update, " +
        "or to default to the slug on create.",
    ),
  executable: z
    .string()
    .optional()
    .describe(
      "Single implementation executable slug. Convenience for the common " +
        "one-executable case. For multi-executable duties, use `executables` " +
        "(an array) instead. Omit to preserve the existing executable on " +
        "update. On create, omit for normal folder duties that the built-in " +
        "duty runner should execute.",
    ),
  executables: z
    .array(z.string().min(1).max(64))
    .optional()
    .describe(
      "Multi-run executable slugs. The duty will run these in order on " +
        "each tick. Use this instead of `executable` when the duty needs " +
        "more than one implementation step. Each item is written to " +
        "profile.json as `executables`. An empty array clears the field. " +
        "Omit to preserve the existing executables on update.",
    ),
  staff: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Staff persona slug that will run this duty, e.g. `qa` or `cto`. " +
        "This matches the engine's `config.staff` field — prefer this over " +
        "the deprecated `runner` alias. Required when CREATING a new duty; " +
        "omitted fields preserve the existing staff on update.",
    ),
  runner: z
    .string()
    .min(1)
    .optional()
    .describe(
      "DEPRECATED — use `staff` instead (the engine reads `config.staff`). " +
        "Accepted as an alias for backwards compatibility; if both `staff` " +
        "and `runner` are passed, `staff` wins. Required when CREATING a " +
        "new duty; omitted fields preserve the existing runner on update.",
    ),
  reviewer: z
    .string()
    .optional()
    .describe(
      "Optional staff persona slug responsible for reviewing or handling the duty output. " +
        "Omit to preserve the existing reviewer on update.",
    ),
  schedule: z
    .enum(DUTY_SCHEDULE_VALUES)
    .optional()
    .describe(
      "Duty profile cadence for `every`. Use `manual` for run-button only, or values like " +
        "`1h`, `1d`, `7d` for auto-run. Omit to preserve the existing schedule on update; " +
        "defaults to `1d` only when CREATING a new duty without an explicit value.",
    ),
  disabled: z
    .boolean()
    .optional()
    .describe(
      "Set true to pause autonomous scheduling. Omit to preserve the current `disabled` flag.",
    ),
  purpose: z
    .string()
    .min(1)
    .optional()
    .describe(
      "One to three sentences describing what the duty scans/observes and what report it produces. " +
        "Required when CREATING a new duty; only used to regenerate the body on update when " +
        "`body` is also omitted AND every other body-building field is provided. " +
        "No implementation details; those go in an executable skill/script when needed.",
    ),
  inputs: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Concrete data sources / commands the duty runs to gather inputs. Each item is one bullet — " +
        'e.g. "`gh pr list --state open --json number,title,createdAt`" or ' +
        '"`gh api repos/{owner}/{repo}/actions/runs?status=failure&per_page=20`". ' +
        "Required when CREATING a new duty; preserve the existing inputs on update unless " +
        "regenerating the body via the body-building fields.",
    ),
  reportSchema: z
    .string()
    .min(1)
    .optional()
    .describe(
      "YAML fragment describing the `findings:` array shape that the duty will produce. " +
        "Required when CREATING a new duty; preserve the existing schema on update unless " +
        "regenerating the body via the body-building fields.",
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
  body: z
    .string()
    .optional()
    .describe(
      "Full markdown body for duty.md (WITHOUT the leading H1 — the H1 is added from `title`). " +
        "If provided on UPDATE, replaces the entire body content. " +
        "If omitted on UPDATE, the existing body is preserved (unless `output` is also changing — see `output`). " +
        "Ignored on CREATE — the body is built from `purpose`/`inputs`/`reportSchema` (or Run-style template when `output: 'run'`).",
    ),
  output: z
    .enum(["run", "report"])
    .optional()
    .describe(
      "Output mode for the duty. `report` (default for backwards compat) bakes the report-producer " +
        "template into duty.md: a `## Output` section with `Refresh <state-branch>:.kody/reports/<slug>.md` " +
        "and a `Maximum one report refresh per tick` restriction. `run` produces a generic Run-style body " +
        "with NO report markers — the engine appears to read body markers to route duties, so " +
        "multi-executable / dispatch-style duties MUST use `run` or the engine dispatches to the " +
        "report-writer path instead of the normal task-job path. `run` also relaxes the create-required " +
        "fields: `inputs` and `reportSchema` become optional. Auto-detected: if `executables` has 2+ " +
        "items and `output` is omitted, the duty is created as `run`. On UPDATE, changing `output` " +
        "regenerates the body in the new mode (requires the appropriate body-building fields: `purpose` " +
        "for `run`; `purpose` + `inputs` + `reportSchema` for `report`).",
    ),
  profile: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Raw profile.json field overrides. Keys are profile.json field " +
        "names (e.g. `tickScript`, `readsFrom`, `writesTo`, `mentions`, " +
        "`dutyTools`, `version`, or any engine-specific field the typed " +
        "schema doesn't expose). Values are merged on top of the typed " +
        "fields — typed values still win for the keys the build function " +
        "manages directly (name, describe, action, runner, reviewer, " +
        "executable, schedule, disabled). Pass `null` to clear a key. " +
        "Use this when the typed schema is too rigid for the shape the " +
        "engine needs; prefer the typed fields when they suffice.",
    ),
});

export function createDutyTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_duty_creation_guide: tool({
      description:
        "Read the required guide for creating Kody duties. Call this before designing or using create_or_update_kody_duty. Also confirms Kody can create duties through chat.",
      inputSchema: z.object({}),
      execute: async () => ({
        canCreateDuty: true,
        creationTool: "create_or_update_kody_duty",
        guide: await readDutyGuide(),
      }),
    }),

    create_or_update_kody_duty: tool({
      description:
        `Create a new Kody Duty in ${repoRef}, or update an existing one. Before calling it, call read_duty_creation_guide (and read_duty for updates) and follow that guide. Commits a duty folder at ` +
        "`.kody/duties/<slug>/` (`profile.json` + `duty.md`). The default template is a REPORT-PRODUCER: each " +
        "scheduled run gathers inputs, composes a YAML findings report, and refreshes " +
        `\`${STATE_BRANCH}:.kody/reports/<slug>.md\`. The kody engine's duty-scheduler ticks every duty folder in ` +
        "`.kody/duties/`; the duty profile's `every` value decides how often it may run.\n\n" +
        "MODES (resolved at call time from whether the slug already exists):\n" +
        "- CREATE: requires `title`, `staff` (or the legacy `runner` alias), `schedule`, " +
        "`purpose`, `inputs` (≥1), `reportSchema`. Builds a fresh duty.md from the " +
        "body-building fields.\n" +
        "- UPDATE: requires `slug` (the existing duty). All other fields are optional — omitted " +
        "fields preserve the current value. Pass `body` to replace the markdown content; otherwise " +
        "the existing body is preserved.\n\n" +
        "KEY FIELDS:\n" +
        "- `staff` — staff persona slug; matches the engine's `config.staff`. `runner` is " +
        "accepted as a deprecated alias (if both are passed, `staff` wins).\n" +
        "- `executables` — array of executable slugs for multi-run duties. `executable` is the " +
        "singular convenience alias; prefer the array for >1.\n" +
        "- `output` — `run` (generic Run-style body, no report markers) or `report` (default; " +
        "bakes the report-producer template into duty.md). The engine reads body markers to " +
        "route duties, so multi-executable / dispatch-style duties MUST use `output: \"run\"` " +
        "(auto-detected when `executables` has 2+ items). On UPDATE, switching `output` " +
        "regenerates the body in the new mode (requires the appropriate body-building fields).\n" +
        "- `profile` — raw profile.json field overrides. Use for engine-specific fields the " +
        "typed schema doesn't expose (e.g. `tickScript`, `readsFrom`, `writesTo`, `mentions`, " +
        "`dutyTools`, `version`). Typed values still win for keys the build function manages.\n\n" +
        "BEFORE CALLING (CREATE): gather title, purpose, staff, reviewer, schedule, output path, " +
        "inputs (data sources as concrete `gh` commands), and reportSchema. Ask the user clarifying " +
        "questions in small batches until each field is well-specified — never invent inputs or schema. " +
        "Show the proposed profile JSON and markdown body for approval before calling.\n\n" +
        "BEFORE CALLING (UPDATE): call `read_duty` to surface the current profile + body, then pass " +
        "only the fields that should change. Show the resulting diff (what changes, what stays) " +
        "for explicit user approval.\n\n" +
        "Returns the duty slug, title, html URL, and the resolved `action` (" +
        "`created` or `updated`) on success. The duty starts ticking on the next scheduler " +
        "wake; updates take effect immediately for the next tick.",
      inputSchema: createOrUpdateKodyDutyInputSchema,
      execute: async (input) => {
        const slugFromInput = (input.slug ?? "").toLowerCase();
        const slugFromTitle = input.title
          ? slugifyTitle(input.title)
          : "";
        const slug = (slugFromInput || slugFromTitle).toLowerCase();
        if (!slug || !isValidSlug(slug)) {
          return {
            error: "invalid_slug",
            message:
              "Duty slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              "On UPDATE, pass the existing `slug`. On CREATE, derive it from the title or pass it explicitly. " +
              `Got "${slug}".`,
          };
        }

        try {
          const existing = await readDutyFile(slug);

          if (!existing) {
            // ── CREATE ───────────────────────────────────────────────────────
            // `staff` is the engine-aligned name; `runner` is a deprecated
            // alias. Either satisfies the create-required check; if both are
            // present, `staff` wins downstream.
            const createStaff = input.staff ?? input.runner;
            // Resolve the output mode up front so validation and body
            // building agree. Run-style duties have relaxed required
            // fields (no `inputs`/`reportSchema`).
            const output = resolveOutput(input);
            const missing: string[] = [];
            if (!input.title) missing.push("title");
            if (!createStaff) missing.push("staff");
            if (!input.schedule) missing.push("schedule");
            if (!input.purpose) missing.push("purpose");
            if (output === "report") {
              if (!input.inputs || input.inputs.length === 0)
                missing.push("inputs");
              if (!input.reportSchema) missing.push("reportSchema");
            }
            if (missing.length > 0) {
              return {
                error: "missing_required_fields",
                message:
                  `Cannot create duty: missing required field(s): ${missing.join(", ")}. ` +
                  `For a Report-style duty (default), ${missing.includes("inputs") || missing.includes("reportSchema") ? "all of `inputs` and `reportSchema`" : "all the listed fields"} are required. ` +
                  `For a Run-style duty, only ${["title", "staff", "schedule", "purpose"].filter((f) => missing.includes(f)).join(", ")} are required — pass \`output: "run"\` to opt in.`,
              };
            }

            const body = buildDutyBody(slug, {
              purpose: input.purpose!,
              inputs: input.inputs ?? [],
              reportSchema: input.reportSchema ?? "",
              executable: input.executable,
              executables: input.executables,
              extraAllowedCommands: input.extraAllowedCommands,
              extraRestrictions: input.extraRestrictions,
              output,
            });
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
            const executables = input.executables ?? [];
            for (const exe of executables) {
              if (!isValidSlug(exe)) {
                return {
                  error: "invalid_executable",
                  message:
                    "Every entry in `executables` must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                    `Got "${exe}".`,
                };
              }
            }
            const message = `feat(duties): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
            const duty = await writeDutyFile({
              octokit,
              slug,
              title: input.title!,
              body,
              schedule: input.schedule!,
              staff: createStaff!,
              reviewer: input.reviewer?.trim().replace(/^@/, "") || null,
              action,
              executable,
              executables: executables.length > 0 ? executables : undefined,
              extraProfile: input.profile,
              message,
            });

            logger.info(
              {
                owner,
                repo,
                slug,
                action,
                executable,
                executables,
                schedule: input.schedule,
                staff: createStaff,
                actorLogin,
              },
              "create_or_update_kody_duty: created duty folder",
            );

            return {
              action: "created" as const,
              slug: duty.slug,
              title: duty.title,
              htmlUrl: duty.htmlUrl,
              note:
                "Duty folder committed. The kody engine's duty-scheduler will pick it up on the next " +
                "scheduler wake. The profile `every` value controls how often it may run.",
            };
          }

          // ── UPDATE ─────────────────────────────────────────────────────────
          // Resolve each field with the read-merge semantics: omitted = preserve.
          // `body` is the only string that overwrites the markdown content
          // (unless `output` is changing — see below); everything else falls
          // back to the existing duty.
          const nextTitle = input.title ?? existing.title;
          const nextSchedule =
            input.schedule ?? existing.schedule ?? undefined;
          // `staff` (engine-aligned) wins over the deprecated `runner` alias.
          const staffProvided = input.staff ?? input.runner;
          const nextStaff = staffProvided ?? existing.runner;
          const nextReviewer =
            input.reviewer !== undefined
              ? (input.reviewer?.trim().replace(/^@/, "") || null)
              : existing.reviewer;
          const nextAction =
            input.action !== undefined
              ? (slugifyTitle(input.action) || existing.action || slug)
              : (existing.action ?? slug);
          if (!isValidSlug(nextAction)) {
            return {
              error: "invalid_action",
              message:
                "Duty action must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${nextAction}".`,
            };
          }
          const nextExecutable =
            input.executable !== undefined
              ? (input.executable?.trim() || null)
              : existing.executable;
          if (nextExecutable && !isValidSlug(nextExecutable)) {
            return {
              error: "invalid_executable",
              message:
                "Executable slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${nextExecutable}".`,
            };
          }
          const nextExecutables =
            input.executables !== undefined ? input.executables : existing.executables;
          for (const exe of nextExecutables) {
            if (!isValidSlug(exe)) {
              return {
                error: "invalid_executable",
                message:
                  "Every entry in `executables` must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                  `Got "${exe}".`,
              };
            }
          }
          const nextDisabled =
            input.disabled !== undefined
              ? input.disabled
              : existing.disabled;
          // Body resolution: explicit `body` wins; otherwise, if `output`
          // changed mode, regenerate in the new mode (requires the
          // body-building fields appropriate for that mode); otherwise
          // preserve the existing body. This is how you flip an existing
          // duty from REPORT to RUN: pass `output: "run"` + a new
          // `purpose` (the model can pass `purpose` for regen, OR
          // `body` to override verbatim).
          const outputSwitched = input.output !== undefined;
          let nextBody: string;
          if (input.body !== undefined) {
            nextBody = input.body;
          } else if (outputSwitched) {
            const targetOutput = input.output!;
            if (targetOutput === "run") {
              if (!input.purpose) {
                return {
                  error: "missing_required_fields",
                  message:
                    "Switching an existing duty to `output: \"run\"` requires a `purpose` (used to regenerate the body) — pass `purpose` to regen, or pass `body` directly to override verbatim.",
                };
              }
              nextBody = buildDutyBody(slug, {
                purpose: input.purpose,
                inputs: input.inputs ?? existing.executables ? [] : [],
                reportSchema: input.reportSchema ?? "",
                executable: input.executable ?? existing.executable ?? undefined,
                executables: nextExecutables.length > 0 ? nextExecutables : input.executables,
                extraAllowedCommands: input.extraAllowedCommands,
                extraRestrictions: input.extraRestrictions,
                output: "run",
              });
            } else {
              const purpose = input.purpose;
              const inputs = input.inputs;
              const reportSchema = input.reportSchema;
              if (!purpose || !inputs || inputs.length === 0 || !reportSchema) {
                return {
                  error: "missing_required_fields",
                  message:
                    "Switching an existing duty to `output: \"report\"` requires `purpose`, `inputs` (≥1), and `reportSchema` (used to regenerate the body) — pass those three to regen, or pass `body` directly to override verbatim.",
                };
              }
              nextBody = buildDutyBody(slug, {
                purpose,
                inputs,
                reportSchema,
                executable: input.executable ?? existing.executable ?? undefined,
                executables: nextExecutables.length > 0 ? nextExecutables : input.executables,
                extraAllowedCommands: input.extraAllowedCommands,
                extraRestrictions: input.extraRestrictions,
                output: "report",
              });
            }
          } else {
            nextBody = existing.body;
          }
          // Track which fields actually changed so the model can narrate
          // the diff. We compare against the existing value the user would
          // see, not the merged `next*` (those already account for read-
          // merge fallbacks).
          const changedFields: string[] = [];
          if (input.title !== undefined && input.title !== existing.title)
            changedFields.push("title");
          if (input.schedule !== undefined && input.schedule !== existing.schedule)
            changedFields.push("schedule");
          if (input.disabled !== undefined && input.disabled !== existing.disabled)
            changedFields.push("disabled");
          if (
            staffProvided !== undefined &&
            staffProvided !== existing.runner
          )
            changedFields.push("staff");
          if (input.reviewer !== undefined && input.reviewer !== existing.reviewer)
            changedFields.push("reviewer");
          if (input.action !== undefined && input.action !== existing.action)
            changedFields.push("action");
          if (input.executable !== undefined && input.executable !== existing.executable)
            changedFields.push("executable");
          if (
            input.executables !== undefined &&
            JSON.stringify(input.executables) !==
              JSON.stringify(existing.executables)
          )
            changedFields.push("executables");
          if (input.body !== undefined || outputSwitched)
            changedFields.push("body");
          if (input.profile !== undefined) changedFields.push("profile");

          const message = `chore(duties): update ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const duty = await writeDutyFile({
            octokit,
            slug,
            title: nextTitle,
            body: nextBody,
            schedule: nextSchedule,
            disabled: nextDisabled,
            staff: nextStaff,
            reviewer: nextReviewer,
            action: nextAction,
            executable: nextExecutable,
            executables:
              nextExecutables && nextExecutables.length > 0
                ? nextExecutables
                : undefined,
            extraProfile: input.profile,
            sha: existing.sha,
            message,
          });

          logger.info(
            {
              owner,
              repo,
              slug,
              changedFields,
              outputSwitched,
              schedule: nextSchedule,
              staff: nextStaff,
              disabled: nextDisabled,
              actorLogin,
            },
            "create_or_update_kody_duty: updated duty folder",
          );

          return {
            action: "updated" as const,
            slug: duty.slug,
            title: duty.title,
            htmlUrl: duty.htmlUrl,
            changedFields,
            note:
              changedFields.length === 0
                ? "No-op update — every supplied field matched the existing value."
                : `Updated ${changedFields.join(", ")}. The duty will pick up the changes on the next tick.`,
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_or_update_kody_duty failed",
          );
          return {
            error: "write_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to write duty folder",
          };
        }
      },
    }),
  };
}
