/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary AgentResponsibility create-or-update tool for the kody-direct chat agent.
 *   Writes a `.kody/agent-responsibilities/<slug>/` folder via the same `writeAgentResponsibilityFile`
 *   helper the dashboard's POST /api/kody/agent-responsibilities endpoint uses. Metadata
 *   lands in `profile.json`; human-readable purpose and limits land in
 *   `agent-responsibility.md`. Resolves the slug from the existing folder when present
 *   (update) and from the title otherwise (create) — same tool, two
 *   modes. Mirrors the read-merge semantics of PATCH
 *   `app/api/kody/agent-responsibilities/[slug]/route.ts`: omitted fields are preserved,
 *   only the `body` string explicitly overwrites the markdown content.
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the agentResponsibility is well-specified.
 *   It should call read_agent_responsibility_creation_guide first. For updates, prefer
 *   `read_agent_responsibility` first to surface the current profile + body before
 *   patching.
 */
import { readFile } from "fs/promises";
import path from "path";
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import {
  readAgentResponsibilityFile,
  writeAgentResponsibilityFile,
  isValidSlug,
} from "@dashboard/lib/agent-responsibilities-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  // Login of the chat user. Used in the commit message for traceability.
  actorLogin: string | null;
}

interface AgentResponsibilityInput {
  title?: string;
  slug?: string;
  action?: string;
  agentAction?: string;
  agentActions?: string[];
  agent?: string;
  reviewer?: string;
  purpose: string;
  inputs?: string[];
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

async function readAgentResponsibilityGuide(): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "docs/agent-responsibilities.md"), "utf8");
  } catch {
    return [
      "# Kody agentResponsibilities",
      "",
      "- Kody can create or update agentResponsibilities with `create_or_update_agent_responsibility`.",
      "- AgentResponsibilities live at `.kody/agent-responsibilities/<slug>/profile.json` plus `agent-responsibility.md`.",
      "- A agentResponsibility owns public action, purpose, agent, reviewer, and safety rules. Goals/loops own cadence.",
      "- Put agentIdentity in `.kody/agents/<slug>.md`.",
      "- Put reusable action logic in `.kody/agent-actions/<slug>/`.",
      "- Do not put metadata or raw state keys in `agent-responsibility.md`; runtime state belongs to the engine.",
    ].join("\n");
  }
}

function buildAgentResponsibilityBody(input: AgentResponsibilityInput): string {
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];
  const agentActions = canonicalizeAgentActions(input);
  const inputs = (input.inputs ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  let body = "";
  body += `## Job\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  if (agentActions.length === 1) {
    body += `## AgentAction\n\n`;
    body += `Run the \`${agentActions[0]}\` agentAction. Its skills and scripts own the implementation details.\n\n`;
  } else if (agentActions.length > 1) {
    body += `## AgentActions\n\n`;
    body += `This agentResponsibility runs the following agentActions in order:\n\n`;
    for (const exe of agentActions) {
      body += `- \`${exe}\`\n`;
    }
    body += `\nEach agentAction's skills and scripts own its implementation details.\n\n`;
  }

  if (inputs.length > 0) {
    body += `## Inputs\n\n`;
    body += `${bullets(inputs)}\n\n`;
  }

  body += `## Allowed Commands\n\n`;
  if (agentActions.length === 1) {
    body += `- Run the \`${agentActions[0]}\` agentAction.\n`;
  } else if (agentActions.length > 1) {
    for (const exe of agentActions) {
      body += `- Run the \`${exe}\` agentAction.\n`;
    }
  } else {
    body += `- Use only the tools needed to complete the agentResponsibility's purpose.\n`;
  }
  for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  body += `\n`;

  body += `## Restrictions\n\n`;
  body += `- Stay within the agentResponsibility's purpose and the per-agentAction rules.\n`;
  body += `- Do not perform actions outside the contract defined by this agentResponsibility.\n`;
  body += `- If this agentResponsibility needs to produce a report, run the configured report agentAction instead of writing report files directly.\n`;
  for (const r of extraRest) body += `- ${r.trim()}\n`;

  return body;
}

/**
 * Canonicalize the agentActions list: prefer the explicit `agentActions`
 * array, fall back to the singular `agentAction` if the list is missing
 * or empty. Empty result means the agentResponsibility has no agentActions.
 */
function canonicalizeAgentActions(input: AgentResponsibilityInput): string[] {
  if (input.agentActions && input.agentActions.length > 0) {
    return input.agentActions.map((e) => e.trim()).filter((e) => e.length > 0);
  }
  const singular = input.agentAction?.trim();
  return singular ? [singular] : [];
}

export const createOrUpdateKodyAgentResponsibilityInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Human-readable agentResponsibility title (becomes the H1 of agent-responsibility.md). " +
        "Required when CREATING a new agentResponsibility; omitted fields preserve the existing title on update.",
    ),
  slug: z
    .string()
    .optional()
    .describe(
      "AgentResponsibility slug (lowercase letters, digits, dashes, underscores; max 64 chars). " +
        "Required on UPDATE — pass the existing slug to identify which agentResponsibility to change. " +
        "On create, if omitted, derived from the title.",
    ),
  action: z
    .string()
    .optional()
    .describe(
      "Public @kody action name. Omit to preserve the existing action on update, " +
        "or to default to the slug on create.",
    ),
  agentAction: z
    .string()
    .optional()
    .describe(
      "Single implementation agentAction slug. Convenience for the common " +
        "one-agentAction case. For multi-agentAction agentResponsibilities, use `agentActions` " +
        "(an array) instead. Omit to preserve the existing agentAction on " +
        "update. On create, omit for normal folder agentResponsibilities that the built-in " +
        "agentResponsibility agent should execute.",
    ),
  agentActions: z
    .array(z.string().min(1).max(64))
    .optional()
    .describe(
      "Multi-run agentAction slugs. The agentResponsibility will run these in order on " +
        "each tick. Use this instead of `agentAction` when the agentResponsibility needs " +
        "more than one implementation step. Each item is written to " +
        "profile.json as `agentActions`. An empty array clears the field. " +
        "Omit to preserve the existing agentActions on update.",
    ),
  agent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "AgentIdentity slug that will run this agentResponsibility, e.g. `qa` or `cto`. " +
        "This matches the engine's `config.agent` field. Required when CREATING a new agentResponsibility; " +
        "omitted fields preserve the existing agent on update.",
    ),
  reviewer: z
    .string()
    .optional()
    .describe(
      "Optional agentIdentity slug responsible for reviewing or handling the agentResponsibility result. " +
        "Omit to preserve the existing reviewer on update.",
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
      "One to three sentences describing what the agentResponsibility scans, observes, or coordinates. " +
        "Required when CREATING a new agentResponsibility; only used to regenerate the body on update when " +
        "`body` is also omitted AND every other body-building field is provided. " +
        "No implementation details; those go in an agentAction skill/script when needed.",
    ),
  inputs: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional concrete data sources / commands the agentResponsibility uses as inputs. Each item is one bullet — " +
        'e.g. "`gh pr list --state open --json number,title,createdAt`" or ' +
        '"`gh api repos/{owner}/{repo}/actions/runs?status=failure&per_page=20`". ' +
        "Preserve existing body content on update unless `body` is passed.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional additional allowed commands for the agentResponsibility body (e.g. " +
        '"`gh pr list`", "`gh run list`"). Each item becomes a bullet under "Allowed Commands".',
    ),
  extraRestrictions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional additional restriction bullets to append (e.g. "Never comment on PRs from this agentResponsibility.").',
    ),
  body: z
    .string()
    .optional()
    .describe(
      "Full markdown body for agent-responsibility.md (WITHOUT the leading H1 — the H1 is added from `title`). " +
        "If provided on CREATE or UPDATE, uses/replaces the entire body content. " +
        "If omitted on CREATE, the body is built from `purpose`, optional `inputs`, and agentAction fields. " +
        "If omitted on UPDATE, the existing body is preserved.",
    ),
  profile: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Raw profile.json field overrides. Keys are profile.json field " +
        "names (e.g. `tickScript`, `readsFrom`, `writesTo`, `mentions`, " +
        "`agentResponsibilityTools`, `version`, or any engine-specific field the typed " +
        "schema doesn't expose). Values are merged on top of the typed " +
        "fields — typed values still win for the keys the build function " +
        "manages directly (name, describe, action, agent, reviewer, " +
        "agentAction, disabled). Pass `null` to clear a key. " +
        "Use this when the typed schema is too rigid for the shape the " +
        "engine needs; prefer the typed fields when they suffice.",
    ),
});

export function createAgentResponsibilityTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_agent_responsibility_creation_guide: tool({
      description:
        "Read the required guide for creating Kody agentResponsibilities. Call this before designing or using create_or_update_agent_responsibility. Also confirms Kody can create agentResponsibilities through chat.",
      inputSchema: z.object({}),
      execute: async () => ({
        canCreateAgentResponsibility: true,
        creationTool: "create_or_update_agent_responsibility",
        guide: await readAgentResponsibilityGuide(),
      }),
    }),

    create_or_update_agent_responsibility: tool({
      description:
        `Create a new Kody AgentResponsibility in ${repoRef}, or update an existing one. Before calling it, call read_agent_responsibility_creation_guide (and read_agent_responsibility for updates) and follow that guide. Commits a agentResponsibility folder at ` +
        "`.kody/agent-responsibilities/<slug>/` (`profile.json` + `agent-responsibility.md`). The responsibility body describes purpose, allowed commands, and restrictions. Report generation belongs in a configured agentAction that writes reports to the configured Kody state repo, not in the responsibility body. Goals and loops dispatch agentResponsibilities from " +
        "MODES (resolved at call time from whether the slug already exists):\n" +
        "- CREATE: requires `title`, `agent`, `purpose`. Builds a fresh agent-responsibility.md from the body fields unless `body` is passed.\n" +
        "- UPDATE: requires `slug` (the existing agentResponsibility). All other fields are optional — omitted " +
        "fields preserve the current value. Pass `body` to replace the markdown content; otherwise " +
        "the existing body is preserved.\n\n" +
        "KEY FIELDS:\n" +
        "- `agent` — agentIdentity slug; matches engine's `config.agent`.\n" +
        "- `agentActions` — array of agentAction slugs for multi-run agentResponsibilities. `agentAction` is the " +
        "singular convenience alias; prefer the array for >1.\n" +
        "- reports — if this responsibility should create reports, point it at a report agentAction; do not add report settings or report paths to the responsibility.\n" +
        "- `profile` — raw profile.json field overrides. Use for engine-specific fields the " +
        "typed schema doesn't expose (e.g. `tickScript`, `readsFrom`, `writesTo`, `mentions`, " +
        "`agentResponsibilityTools`, `version`). Typed values still win for keys the build function manages.\n\n" +
        "BEFORE CALLING (CREATE): gather title, purpose, agent, reviewer, optional agentActions, and optional inputs. Ask the user clarifying " +
        "questions in small batches until each field is well-specified — never invent inputs or schema. " +
        "Show the proposed profile JSON and markdown body for approval before calling.\n\n" +
        "BEFORE CALLING (UPDATE): call `read_agent_responsibility` to surface the current profile + body, then pass " +
        "only the fields that should change. Show the resulting diff (what changes, what stays) " +
        "for explicit user approval.\n\n" +
        "Returns the agentResponsibility slug, title, html URL, and the resolved `action` (" +
        "`created` or `updated`) on success. The agentResponsibility runs when a goal or loop dispatches it.",
      inputSchema: createOrUpdateKodyAgentResponsibilityInputSchema,
      execute: async (input) => {
        const slugFromInput = (input.slug ?? "").toLowerCase();
        const slugFromTitle = input.title ? slugifyTitle(input.title) : "";
        const slug = (slugFromInput || slugFromTitle).toLowerCase();
        if (!slug || !isValidSlug(slug)) {
          return {
            error: "invalid_slug",
            message:
              "AgentResponsibility slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              "On UPDATE, pass the existing `slug`. On CREATE, derive it from the title or pass it explicitly. " +
              `Got "${slug}".`,
          };
        }

        try {
          const existing = await readAgentResponsibilityFile(slug);

          if (!existing) {
            // ── CREATE ───────────────────────────────────────────────────────
            const createAgent = input.agent;
            const missing: string[] = [];
            if (!input.title) missing.push("title");
            if (!createAgent) missing.push("agent");
            if (!input.purpose) missing.push("purpose");
            if (missing.length > 0) {
              return {
                error: "missing_required_fields",
                message:
                  `Cannot create agentResponsibility: missing required field(s): ${missing.join(", ")}.`,
              };
            }

            const body =
              input.body ??
              buildAgentResponsibilityBody({
                purpose: input.purpose!,
                inputs: input.inputs,
                agentAction: input.agentAction,
                agentActions: input.agentActions,
                extraAllowedCommands: input.extraAllowedCommands,
                extraRestrictions: input.extraRestrictions,
              });
            const action = slugifyTitle(input.action ?? slug);
            if (!isValidSlug(action)) {
              return {
                error: "invalid_action",
                message:
                  "AgentResponsibility action must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                  `Got "${action}".`,
              };
            }
            const agentAction = input.agentAction?.trim() || null;
            if (agentAction && !isValidSlug(agentAction)) {
              return {
                error: "invalid_agentAction",
                message:
                  "AgentAction slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                  `Got "${agentAction}".`,
              };
            }
            const agentActions = input.agentActions ?? [];
            for (const exe of agentActions) {
              if (!isValidSlug(exe)) {
                return {
                  error: "invalid_agentAction",
                  message:
                    "Every entry in `agentActions` must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                    `Got "${exe}".`,
                };
              }
            }
            const message = `feat(agentResponsibilities): add ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
            const agentResponsibility = await writeAgentResponsibilityFile({
              octokit,
              slug,
              title: input.title!,
              body,
              agent: createAgent!,
              reviewer: input.reviewer?.trim().replace(/^@/, "") || null,
              action,
              agentAction,
              agentActions: agentActions.length > 0 ? agentActions : undefined,
              extraProfile: input.profile,
              message,
            });

            logger.info(
              {
                owner,
                repo,
                slug,
                action,
                agentAction,
                agentActions,
                agent: createAgent,
                actorLogin,
              },
              "create_or_update_agent_responsibility: created agentResponsibility folder",
            );

            return {
              action: "created" as const,
              slug: agentResponsibility.slug,
              title: agentResponsibility.title,
              htmlUrl: agentResponsibility.htmlUrl,
              note:
              "AgentResponsibility folder committed. Add it to a goal or loop to run it.",
            };
          }

          // ── UPDATE ─────────────────────────────────────────────────────────
          // Resolve each field with the read-merge semantics: omitted = preserve.
          // `body` is the only string that overwrites the markdown content;
          // everything else falls
          // back to the existing agentResponsibility.
          const nextTitle = input.title ?? existing.title;
          const agentProvided = input.agent;
          const nextAgent = agentProvided ?? existing.agent;
          const nextReviewer =
            input.reviewer !== undefined
              ? input.reviewer?.trim().replace(/^@/, "") || null
              : existing.reviewer;
          const nextAction =
            input.action !== undefined
              ? slugifyTitle(input.action) || existing.action || slug
              : (existing.action ?? slug);
          if (!isValidSlug(nextAction)) {
            return {
              error: "invalid_action",
              message:
                "AgentResponsibility action must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${nextAction}".`,
            };
          }
          const nextAgentAction =
            input.agentAction !== undefined
              ? input.agentAction?.trim() || null
              : existing.agentAction;
          if (nextAgentAction && !isValidSlug(nextAgentAction)) {
            return {
              error: "invalid_agentAction",
              message:
                "AgentAction slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                `Got "${nextAgentAction}".`,
            };
          }
          const nextAgentActions =
            input.agentActions !== undefined
              ? input.agentActions
              : existing.agentActions;
          for (const exe of nextAgentActions) {
            if (!isValidSlug(exe)) {
              return {
                error: "invalid_agentAction",
                message:
                  "Every entry in `agentActions` must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
                  `Got "${exe}".`,
              };
            }
          }
          const nextDisabled =
            input.disabled !== undefined ? input.disabled : existing.disabled;
          const nextBody =
            input.body !== undefined ? input.body : existing.body;
          // Track which fields actually changed so the model can narrate
          // the diff. We compare against the existing value the user would
          // see, not the merged `next*` (those already account for read-
          // merge fallbacks).
          const changedFields: string[] = [];
          if (input.title !== undefined && input.title !== existing.title)
            changedFields.push("title");
          if (
            input.disabled !== undefined &&
            input.disabled !== existing.disabled
          )
            changedFields.push("disabled");
          if (agentProvided !== undefined && agentProvided !== existing.agent)
            changedFields.push("agent");
          if (
            input.reviewer !== undefined &&
            input.reviewer !== existing.reviewer
          )
            changedFields.push("reviewer");
          if (input.action !== undefined && input.action !== existing.action)
            changedFields.push("action");
          if (
            input.agentAction !== undefined &&
            input.agentAction !== existing.agentAction
          )
            changedFields.push("agentAction");
          if (
            input.agentActions !== undefined &&
            JSON.stringify(input.agentActions) !==
              JSON.stringify(existing.agentActions)
          )
            changedFields.push("agentActions");
          if (input.body !== undefined) changedFields.push("body");
          if (input.profile !== undefined) changedFields.push("profile");

          const message = `chore(agentResponsibilities): update ${slug}${actorLogin ? ` (via chat by @${actorLogin})` : ""}`;
          const agentResponsibility = await writeAgentResponsibilityFile({
            octokit,
            slug,
            title: nextTitle,
            body: nextBody,
            disabled: nextDisabled,
            agent: nextAgent,
            reviewer: nextReviewer,
            action: nextAction,
            agentAction: nextAgentAction,
            agentActions:
              nextAgentActions && nextAgentActions.length > 0
                ? nextAgentActions
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
              agent: nextAgent,
              disabled: nextDisabled,
              actorLogin,
            },
            "create_or_update_agent_responsibility: updated agentResponsibility folder",
          );

          return {
            action: "updated" as const,
            slug: agentResponsibility.slug,
            title: agentResponsibility.title,
            htmlUrl: agentResponsibility.htmlUrl,
            changedFields,
            note:
              changedFields.length === 0
                ? "No-op update — all supplied fields matched the existing value."
                : `Updated ${changedFields.join(", ")}. The agentResponsibility will pick up the changes on the next tick.`,
          };
        } catch (err) {
          logger.warn(
            { err, owner, repo, slug, title: input.title },
            "create_or_update_agent_responsibility failed",
          );
          return {
            error: "write_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to write agentResponsibility folder",
          };
        }
      },
    }),
  };
}
