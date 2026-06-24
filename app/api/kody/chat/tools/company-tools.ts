/**
 * @fileType util
 * @domain company
 * @pattern chat-tools
 * @ai-summary Chat tools for the "company" — the portable bundle of
 *   agent/agent-responsibilities/commands/agent-actions/instructions/config, plus the operator
 *   handles that route recommendations to the inbox. Read config + operators,
 *   set operators, export the bundle, import a bundle. Mirrors the
 *   /api/kody/company routes.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { buildCompanyBundle } from "@dashboard/lib/company/export";
import { applyCompanyBundle } from "@dashboard/lib/company/import";
import { companyBundleSchema } from "@dashboard/lib/company/types";
import { readOperators, writeOperators } from "@dashboard/lib/engine/config";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createCompanyTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_operators: tool({
      description: `Read the operator @-handles for ${repoRef} (from kody.config.json). These are the people recommendations @-mention so they land in the inbox — an empty list means nobody gets inbox routing.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const operators = await readOperators(octokit, owner, repo);
          return { operators };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_operators: tool({
      description: `Set the operator @-handles for ${repoRef} (replaces the whole list in kody.config.json). Pass GitHub logins WITHOUT the leading @. This controls who recommendations route to in the inbox.`,
      inputSchema: z.object({
        operators: z.array(z.string().min(1)).max(100),
      }),
      execute: async ({ operators }) => {
        try {
          const result = await writeOperators(octokit, owner, repo, operators);
          return { ok: true, operators: result.operators };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    export_company: tool({
      description: `Export ${repoRef}'s company bundle — all agent, agentResponsibilities, context, commands, agentActions, instructions, and config — as a portable JSON object the user can save or import into another repo.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const bundle = await buildCompanyBundle();
          return { bundle };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    import_company: tool({
      description: `Import a company bundle into ${repoRef}. \`mode\` "skip" keeps existing items on slug collision; "overwrite" replaces them. Pass the full bundle JSON (as produced by export_company). Returns per-category created/updated/skipped counts.`,
      inputSchema: z.object({
        bundle: z.unknown(),
        mode: z.enum(["skip", "overwrite"]).default("skip"),
      }),
      execute: async ({ bundle, mode }) => {
        const parsed = companyBundleSchema.safeParse(bundle);
        if (!parsed.success)
          return { error: "invalid_bundle", details: parsed.error.format() };
        try {
          const result = await applyCompanyBundle(octokit, parsed.data, mode);
          return { ok: true, result };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
