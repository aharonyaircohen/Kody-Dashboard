/**
 * @fileType util
 * @domain capabilities
 * @pattern chat-tools
 * @ai-summary In-process chat tools that let Kody build and manage custom
 *   capabilities (`capabilities/<slug>/` in the state repo) by conversation.
 */
import { readFile } from "fs/promises";
import path from "path";
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listCapabilityFiles,
  readCapabilityFile,
  writeCapabilityFile,
  deleteCapabilityFile,
  isValidSlug,
  composeProfile,
  validateProfile,
  PERMISSION_MODES,
} from "@dashboard/lib/capabilities";
import { dashboardCapabilityUrl } from "@dashboard/lib/thread-link";

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

async function readCapabilityGuide(): Promise<string> {
  try {
    return await readFile(
      path.join(process.cwd(), "docs/capabilities.md"),
      "utf8",
    );
  } catch {
    return [
      "# How to create a proper capability",
      "",
      "- Kody can create or update capabilities with `create_or_update_capability`.",
      "- Capabilities live at state repo `capabilities/<slug>/profile.json` plus `capability.md`.",
      "- Keep `capability.md` as small operator-owned instructions.",
      "- Put reusable method/rules in `skills/<name>/SKILL.md`.",
      "- Put deterministic setup work in capability-owned `*.sh` scripts.",
      "- Use MCP tools only for external callable tool servers.",
      "- Use `skipAgent` when a script owns the full implementation.",
    ].join("\n");
  }
}

function actionFromCapability(slug: string, profileJson: string): string {
  try {
    const profile = JSON.parse(profileJson) as {
      action?: unknown;
      name?: unknown;
    };
    const action = typeof profile.action === "string" ? profile.action : null;
    const name = typeof profile.name === "string" ? profile.name : null;
    return action || name || slug;
  } catch {
    return slug;
  }
}

export function createCapabilityTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_capability_creation_guide: tool({
      description:
        "Read the required guide for creating or editing capabilities. Call this before designing or using create_or_update_capability.",
      inputSchema: z.object({}),
      execute: async () => ({
        canCreateCapability: true,
        creationTool: "create_or_update_capability",
        guide: await readCapabilityGuide(),
      }),
    }),

    list_capabilities: tool({
      description: `List custom capabilities in ${repoRef} stored at state repo capabilities/<slug>/. Returns slug, description, tools, and landing.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const capabilities = await listCapabilityFiles();
          return { capabilities };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_capability: tool({
      description: `Read one custom capability from ${repoRef} in full: instructions, model, tools, skills, shell scripts, and raw profile.json.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const capability = await readCapabilityFile(slug, octokit);
          if (!capability) return { error: `capability "${slug}" not found` };
          return { capability };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_capability: tool({
      description:
        `Create or update a custom capability in ${repoRef}. Before calling it, call read_capability_creation_guide and follow that guide. ` +
        "Commits state repo capabilities/<slug>/ (profile.json + capability.md + any skills/scripts) as one commit.",
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
        if (!isValidSlug(input.slug)) {
          return { error: `invalid slug "${input.slug}"` };
        }

        const fields = {
          slug: input.slug,
          describe: input.describe,
          prompt: input.instructions,
          model: input.model,
          permissionMode: input.permissionMode,
          tools: input.tools,
          skills: input.skills.map((s) => s.name),
          shellScripts: input.shellScripts.map((s) => s.name),
          mcpServers: [],
          landing: input.landing,
        };

        const errors = validateProfile(composeProfile(fields));
        if (errors.length > 0) {
          return { error: `invalid profile: ${errors.join("; ")}` };
        }

        try {
          const existing = await readCapabilityFile(input.slug, octokit);
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

          await writeCapabilityFile({
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
            htmlUrl: dashboardCapabilityUrl(input.slug),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_capability: tool({
      description: `Delete a custom capability from ${repoRef}; removes the whole state repo capabilities/<slug>/ folder in one commit.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readCapabilityFile(slug, octokit);
          if (!existing) return { error: `capability "${slug}" not found` };
          await deleteCapabilityFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    run_capability: tool({
      description: `Run a capability NOW in ${repoRef}. Dispatches kody.yml with the capability action.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readCapabilityFile(slug, octokit);
          if (!existing) return { error: `capability "${slug}" not found` };
          const repoMeta = await octokit.rest.repos.get({ owner, repo });
          const ref = repoMeta.data.default_branch || "main";
          const action = actionFromCapability(slug, existing.profileJson);
          await octokit.rest.actions.createWorkflowDispatch({
            owner,
            repo,
            workflow_id: "kody.yml",
            ref,
            inputs: { capability: action },
          });
          return {
            ok: true,
            workflowId: "kody.yml",
            ref,
            action,
            capability: slug,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
