/**
 * @fileType util
 * @domain staff
 * @pattern chat-tools
 * @ai-summary Lifecycle chat tools for staff personas, complementing
 *   create_kody_staff (in staff-tools.ts): list, read, delete, and dispatch a
 *   one-off task to a staff member via the worker-ask path. Kept separate from
 *   the create tool so the gap-analysis creation flow stays untouched.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listStaffFiles,
  readStaffFile,
  deleteStaffFile,
  isValidSlug,
} from "@dashboard/lib/staff-files";
import { dispatchWorkerAsk } from "@dashboard/lib/control-issue";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createStaffAdminTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_staff: tool({
      description: `List the staff personas in ${repoRef} (.kody/staff/). Returns slug and title for each reusable persona.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const staff = await listStaffFiles();
          return { staff: staff.map((s) => ({ slug: s.slug, title: s.title })) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_staff: tool({
      description: `Read one staff persona from ${repoRef} in full (the markdown body: intent, allowed commands, restrictions).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const staff = await readStaffFile(slug);
          if (!staff) return { error: `staff "${slug}" not found` };
          return { staff };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_staff: tool({
      description: `Delete a staff persona from ${repoRef} (removes .kody/staff/<slug>.md).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readStaffFile(slug);
          if (!existing) return { error: `staff "${slug}" not found` };
          await deleteStaffFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    dispatch_staff: tool({
      description: `Send a one-off task to a staff member in ${repoRef}. Posts \`@kody <slug> <message>\` to the control issue (the worker-ask path), so the staff persona runs once on this task. Use for "ask the qa-engineer to ...". Returns the comment URL.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        message: z.string().min(1).max(8000),
      }),
      execute: async ({ slug, message }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readStaffFile(slug);
          if (!existing) return { error: `staff "${slug}" not found` };
          const result = await dispatchWorkerAsk(octokit, owner, repo, {
            slug,
            message,
          });
          return { ok: true, ...result };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
