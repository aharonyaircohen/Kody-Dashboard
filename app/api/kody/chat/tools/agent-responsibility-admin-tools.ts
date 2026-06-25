/**
 * @fileType util
 * @domain agentResponsibilities
 * @pattern chat-tools
 * @ai-summary Lifecycle chat tools for agentResponsibilities, complementing
 *   create_or_update_agent_responsibility (in agentResponsibility-tools.ts): list, read, delete, and run-now. Run
 *   dispatches kody.yml with the agentResponsibility-owned action. Kept separate from the
 *   creation flow.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listAgentResponsibilityFiles,
  readAgentResponsibilityFile,
  deleteAgentResponsibilityFile,
  isValidSlug,
} from "@dashboard/lib/agent-responsibilities-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createAgentResponsibilityAdminTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_agentResponsibilities: tool({
      description: `List agentResponsibilities in ${repoRef} (state repo agent-responsibilities/). Returns slug, action, implementation agentAction, disabled flag, and last-tick info for each.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const agentResponsibilities = await listAgentResponsibilityFiles();
          return {
            agentResponsibilities: agentResponsibilities.map((d) => ({
              slug: d.slug,
              action: d.action,
              title: d.title,
              agentAction: d.agentAction,
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

    read_agent_responsibility: tool({
      description: `Read one agentResponsibility from ${repoRef} in full (the markdown body: job, allowed commands, restrictions, state).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const agentResponsibility = await readAgentResponsibilityFile(slug);
          if (!agentResponsibility) return { error: `agentResponsibility "${slug}" not found` };
          return { agentResponsibility };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_agentResponsibility: tool({
      description: `Delete an agentResponsibility from ${repoRef} (removes agent-responsibilities/<slug>/ from the state repo).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readAgentResponsibilityFile(slug);
          if (!existing) return { error: `agentResponsibility "${slug}" not found` };
          await deleteAgentResponsibilityFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    run_agentResponsibility: tool({
      description: `Run a agentResponsibility NOW in ${repoRef}. Dispatches kody.yml with the agentResponsibility action. Use for "run the X agentResponsibility now".`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readAgentResponsibilityFile(slug);
          if (!existing) return { error: `agentResponsibility "${slug}" not found` };
          const repoMeta = await octokit.rest.repos.get({
            owner,
            repo,
          });
          const ref = repoMeta.data.default_branch || "main";
          const action = existing.action ?? slug;
          await octokit.rest.actions.createWorkflowDispatch({
            owner,
            repo,
            workflow_id: "kody.yml",
            ref,
            inputs: { agentAction: action },
          });
          return {
            ok: true,
            workflowId: "kody.yml",
            ref,
            action,
            agentResponsibility: slug,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
