/**
 * @fileType util
 * @domain executables
 * @pattern chat-tools
 * @ai-summary In-process chat tools that let Kody build and manage custom
 *   executables (`.kody/executables/<slug>/`) by conversation — list, read,
 *   create/update, delete. Writes commit the whole folder atomically under
 *   the acting user's token. Mirrors the memory-tools shape; reads rely on
 *   the module-level GitHub context the chat route sets, writes pass the
 *   per-request octokit explicitly.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listExecutableFiles,
  readExecutableFile,
  writeExecutableFile,
  deleteExecutableFile,
  isValidSlug,
  composeProfile,
  validateProfile,
  PERMISSION_MODES,
} from "@dashboard/lib/executables";

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

export function createExecutableTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_executables: tool({
      description: `List the custom executables in ${repoRef} (the @kody <slug> actions stored at .kody/executables/). Returns slug, description, and landing (opens a PR vs comments).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const executables = await listExecutableFiles();
          return { executables };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_executable: tool({
      description: `Read one custom executable from ${repoRef} in full (prompt, model, tools, skills, shell scripts, and raw profile.json).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const executable = await readExecutableFile(slug, octokit);
          if (!executable) return { error: `executable "${slug}" not found` };
          return { executable };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_executable: tool({
      description: `Create or update a custom executable in ${repoRef}. Commits .kody/executables/<slug>/ (profile.json + prompt.md + any skills/scripts) as one commit. \`landing\` "pr" opens a pull request; "comment" posts a comment. Skills install via the names you give; each skill body is its SKILL.md. Shell scripts run as preflight steps.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        describe: z.string().default(""),
        prompt: z.string().min(1),
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
          prompt: input.prompt,
          model: input.model,
          permissionMode: input.permissionMode,
          tools: input.tools,
          skills: input.skills.map((s) => s.name),
          shellScripts: input.shellScripts.map((s) => s.name),
          // MCP tool servers aren't exposed via the chat tool path; the
          // dashboard editor (Tools tab) is where they're configured.
          mcpServers: [],
          landing: input.landing,
          staff: null,
          every: null,
          mentions: [],
        };

        // Reject a malformed profile before committing.
        const errors = validateProfile(composeProfile(fields));
        if (errors.length > 0)
          return { error: `invalid profile: ${errors.join("; ")}` };

        try {
          const existing = await readExecutableFile(input.slug, octokit);
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

          const executable = await writeExecutableFile({
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
            htmlUrl: executable.htmlUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_executable: tool({
      description: `Delete a custom executable from ${repoRef} (removes the whole .kody/executables/<slug>/ folder in one commit).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readExecutableFile(slug, octokit);
          if (!existing) return { error: `executable "${slug}" not found` };
          await deleteExecutableFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
