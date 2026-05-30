/**
 * @fileType util
 * @domain duties
 * @pattern chat-tools
 * @ai-summary Lifecycle chat tools for scheduled duties, complementing
 *   create_kody_duty (in duty-tools.ts): list, read, delete, and run-now. Run
 *   posts `@kody job-tick --job <slug> --force` to the control issue, bypassing
 *   the cadence guard. Kept separate from the creation flow.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listDutyFiles,
  readDutyFile,
  deleteDutyFile,
  isValidSlug,
} from "@dashboard/lib/duties-files";
import { dispatchJobTick } from "@dashboard/lib/control-issue";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createDutyAdminTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_duties: tool({
      description: `List the scheduled duties in ${repoRef} (.kody/duties/). Returns slug, title, schedule, disabled flag, and last-tick info for each.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const duties = await listDutyFiles();
          return {
            duties: duties.map((d) => ({
              slug: d.slug,
              title: d.title,
              schedule: d.schedule,
              disabled: d.disabled,
              lastTickAt: d.lastTickAt,
              lastOutcome: d.lastOutcome,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_duty: tool({
      description: `Read one duty from ${repoRef} in full (the markdown body: job, allowed commands, restrictions, state).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const duty = await readDutyFile(slug);
          if (!duty) return { error: `duty "${slug}" not found` };
          return { duty };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_duty: tool({
      description: `Delete a scheduled duty from ${repoRef} (removes .kody/duties/<slug>.md). It stops ticking immediately.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readDutyFile(slug);
          if (!existing) return { error: `duty "${slug}" not found` };
          await deleteDutyFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    run_duty: tool({
      description: `Run a duty NOW in ${repoRef}, bypassing its cadence guard. Posts \`@kody job-tick --job <slug> --force\` to the control issue. Use for "run the X duty now". Returns the comment URL.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readDutyFile(slug);
          if (!existing) return { error: `duty "${slug}" not found` };
          const result = await dispatchJobTick(octokit, owner, repo, {
            slug,
            force: true,
          });
          return { ok: true, ...result };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
