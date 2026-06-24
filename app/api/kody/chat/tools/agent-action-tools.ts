/**
 * @fileType util
 * @domain agentActions
 * @pattern chat-tools
 * @ai-summary In-process chat tools that let Kody build and manage custom
 *   agentActions (`.kody/agent-actions/<slug>/`) by conversation — list, read,
 *   create/update, delete. Writes commit the whole folder atomically
 *   under the acting user's token. Mirrors the memory-tools shape; reads
 *   rely on the module-level GitHub context the chat route sets, writes
 *   pass the per-request octokit explicitly.
 */
import { readFile } from "fs/promises";
import path from "path";
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listAgentActionFiles,
  readAgentActionFile,
  writeAgentActionFile,
  deleteAgentActionFile,
  isValidSlug,
  composeProfile,
  validateProfile,
  PERMISSION_MODES,
} from "@dashboard/lib/agent-actions";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

const skillSchema = z.object({
  name: z.string().min(1).max(64),
  body: z.string(),
});
const shellSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9._-]+\.sh$/, "must be a *.sh filename"),
  content: z.string(),
});

async function readAgentActionGuide(): Promise<string> {
  try {
    return await readFile(
      path.join(process.cwd(), "docs/agent-actions.md"),
      "utf8",
    );
  } catch {
    return [
      "# How to create a proper agentAction",
      "",
      "- Kody can create or update custom agentActions with `create_or_update_agentAction`.",
      "- Keep `prompt.md` as small operator-owned instructions.",
      "- Put reusable method/rules in `skills/<name>/SKILL.md`.",
      "- Put deterministic work in agentAction-owned `*.sh` scripts.",
      "- Use MCP tools only for external callable tool servers.",
      "- Use `skipAgent` when the script does all the work.",
      "- AgentResponsibilities own purpose, agent, and safety bounds. Goals/loops own cadence.",
    ].join("\n");
  }
}

export function createAgentActionTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_agentAction_creation_guide: tool({
      description: `Read the required guide for creating or editing custom agentActions. Call this before designing or using create_or_update_agentAction. Also confirms Kody can create/update agentActions through chat.`,
      inputSchema: z.object({}),
      execute: async () => ({
        canCreateAgentAction: true,
        creationTool: "create_or_update_agentAction",
        guide: await readAgentActionGuide(),
      }),
    }),

    list_agentActions: tool({
      description: `List the custom agentAction implementations in ${repoRef} stored at .kody/agent-actions/<slug>/. AgentResponsibilities own public @kody action names. Returns slug, description, and landing (opens a PR vs comments).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const agentActions = await listAgentActionFiles();
          return { agentActions };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_agentAction: tool({
      description: `Read one custom agentAction from ${repoRef} in full (instructions, model, tools, skills, shell scripts, and raw profile.json).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const agentAction = await readAgentActionFile(slug, octokit);
          if (!agentAction) return { error: `agentAction "${slug}" not found` };
          return { agentAction };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_agentAction: tool({
      description: `Create or update a custom agentAction in ${repoRef}. Kody can use this tool to create one. Before calling it, call read_agentAction_creation_guide and follow that guide. Commits .kody/agent-actions/<slug>/ (profile.json + prompt.md + any skills/scripts) as one commit. \`landing\` "pr" opens a pull request; "comment" posts a comment. Skills install via the names you give; each skill body is its SKILL.md. Shell scripts run as preflight steps.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        describe: z.string().default(""),
        instructions: z.string().min(1),
        landing: z.enum(["pr", "comment"]).default("pr"),
        model: z.string().default("inherit"),
        permissionMode: z.enum(PERMISSION_MODES).default("acceptEdits"),
        tools: z
          .array(z.string())
          .default(["Read", "Write", "Edit", "Bash", "Grep", "Glob"]),
        skills: z.array(skillSchema).default([]),
        shellScripts: z.array(shellSchema).default([]),
      }),
      execute: async (input) => {
        if (!isValidSlug(input.slug))
          return { error: `invalid slug "${input.slug}"` };

        const fields = {
          slug: input.slug,
          describe: input.describe,
          prompt: input.instructions,
          model: input.model,
          permissionMode: input.permissionMode,
          tools: input.tools,
          skills: input.skills.map((s) => s.name),
          shellScripts: input.shellScripts.map((s) => s.name),
          // MCP tool servers aren't exposed via the chat tool path; the
          // dashboard editor (Tools tab) is where they're configured.
          mcpServers: [],
          landing: input.landing,
        };

        // Reject a malformed profile before committing.
        const errors = validateProfile(composeProfile(fields));
        if (errors.length > 0)
          return { error: `invalid profile: ${errors.join("; ")}` };

        try {
          const existing = await readAgentActionFile(input.slug, octokit);
          const removedSkills = existing
            ? existing.skills
                .map((s) => s.name)
                .filter((n) => !input.skills.some((s) => s.name === n))
            : [];
          const removedShellScripts = existing
            ? existing.shellScripts
                .map((s) => s.name)
                .filter((n) => !input.shellScripts.some((s) => s.name === n))
            : [];

          const agentAction = await writeAgentActionFile({
            octokit,
            fields,
            skills: input.skills,
            shellScripts: input.shellScripts,
            removedSkills,
            removedShellScripts,
            isUpdate: !!existing,
          });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            slug: input.slug,
            htmlUrl: agentAction.htmlUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_agentAction: tool({
      description: `Delete a custom agentAction from ${repoRef} (removes the whole .kody/agent-actions/<slug>/ folder in one commit).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readAgentActionFile(slug, octokit);
          if (!existing) return { error: `agentAction "${slug}" not found` };
          await deleteAgentActionFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
