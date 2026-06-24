/**
 * @fileType util
 * @domain agent
 * @pattern chat-tools
 * @ai-summary Lifecycle chat tools for agentIdentity identities, complementing
 *   create_kody_agent (in agent-tools.ts): list, read, delete, and dispatch a
 *   one-off task to an agent via the agent-ask path. Kept separate from
 *   the create tool so the gap-analysis creation flow stays untouched.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listAgentFiles,
  readAgentFile,
  deleteAgentFile,
  isValidSlug,
} from "@dashboard/lib/agent-files";
import { dispatchAgentAsk } from "@dashboard/lib/control-issue";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createAgentAdminTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_agents: tool({
      description: `List the agentIdentity identities in ${repoRef} (.kody/agents/). Returns slug and title for each reusable agentIdentity.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const agent = await listAgentFiles();
          return {
            agent: agent.map((s) => ({ slug: s.slug, title: s.title })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_agent: tool({
      description: `Read one agentIdentity from ${repoRef} in full (the markdown body: intent, allowed commands, restrictions).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const agent = await readAgentFile(slug);
          if (!agent) return { error: `agent "${slug}" not found` };
          return { agent };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_agent: tool({
      description: `Delete an agentIdentity from ${repoRef} (removes .kody/agents/<slug>.md).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readAgentFile(slug);
          if (!existing) return { error: `agent "${slug}" not found` };
          await deleteAgentFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    dispatch_agent: tool({
      description: `Send a one-off task to an agent in ${repoRef}. Posts \`@kody <slug> <message>\` to the control issue (the agent-ask path), so the agentIdentity runs once on this task. Use for "ask the qa-engineer to ...". Returns the comment URL.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        message: z.string().min(1).max(8000),
      }),
      execute: async ({ slug, message }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readAgentFile(slug);
          if (!existing) return { error: `agent "${slug}" not found` };
          const result = await dispatchAgentAsk(octokit, owner, repo, {
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
