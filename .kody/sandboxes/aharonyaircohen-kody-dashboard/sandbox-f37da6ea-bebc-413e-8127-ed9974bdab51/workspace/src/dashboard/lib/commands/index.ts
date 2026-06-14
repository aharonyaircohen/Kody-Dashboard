/**
 * @fileType module
 * @domain kody
 * @pattern commands-index
 * @ai-summary Public surface for the commands feature. `listCommands()`
 *   merges dashboard built-ins with repo-defined `.kody/commands/*.md`
 *   files. Repo wins on slug collision so a repo can override the
 *   wording of a built-in (e.g. customize `/review` for its codebase).
 *   `.kody/commands/.disable-builtins` suppresses every built-in for the
 *   repo.
 */

import { BUILTIN_COMMANDS } from "./builtins";
import { listRepoCommandFiles, type CommandFile } from "./files";
import { substitute, type SubstituteResult } from "./substitute";

export type { CommandFile } from "./files";
export type { SubstituteResult } from "./substitute";
export {
  isValidSlug,
  readCommandFile,
  writeCommandFile,
  deleteCommandFile,
} from "./files";
export { substitute, tokenizeArguments } from "./substitute";
export { BUILTIN_COMMANDS } from "./builtins";

/**
 * Return every command available to the current repo (builtins + repo
 * files, with repo overriding builtins by slug). Honors the
 * `.disable-builtins` sentinel.
 */
export async function listCommands(): Promise<CommandFile[]> {
  const { commands: repoCommands, builtinsDisabled } =
    await listRepoCommandFiles();
  const repoSlugs = new Set(repoCommands.map((p) => p.slug));

  const builtinsAsFiles: CommandFile[] = builtinsDisabled
    ? []
    : BUILTIN_COMMANDS.filter((b) => !repoSlugs.has(b.slug)).map((b) => ({
        slug: b.slug,
        description: b.description,
        argumentHint: b.argumentHint ?? "",
        body: b.body,
        source: "builtin" as const,
        sha: "",
        updatedAt: "",
        htmlUrl: "",
      }));

  return [...builtinsAsFiles, ...repoCommands].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
}

/**
 * Render a command for sending: look up by slug, substitute arguments,
 * and return the final text. Returns `null` if the slug isn't found.
 */
export async function renderCommand(
  slug: string,
  rawArguments: string,
): Promise<
  (SubstituteResult & { slug: string; source: CommandFile["source"] }) | null
> {
  const all = await listCommands();
  const command = all.find((p) => p.slug === slug);
  if (!command) return null;
  const result = substitute(command.body, rawArguments);
  return { ...result, slug, source: command.source };
}
