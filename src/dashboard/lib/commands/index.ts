/**
 * @fileType module
 * @domain kody
 * @pattern commands-index
 * @ai-summary Public surface for the commands feature. `listCommands()`
 *   merges repo-local commands, activated Store commands, then dashboard fallback
 *   built-ins. Repo wins on slug collision; Store owns shared defaults.
 *   `commands/.disable-builtins` in the state repo suppresses dashboard fallback built-ins.
 */

import { BUILTIN_COMMANDS } from "./builtins";
import {
  listRepoCommandFiles,
  listStoreCommandFiles,
  type CommandFile,
} from "./files";
import { substitute, type SubstituteResult } from "./substitute";

export type { CommandFile } from "./files";
export type { SubstituteResult } from "./substitute";
export {
  isValidSlug,
  readCommandFile,
  readResolvedCommandFile,
  writeCommandFile,
  deleteCommandFile,
} from "./files";
export { substitute, tokenizeArguments } from "./substitute";
export { BUILTIN_COMMANDS } from "./builtins";

/**
 * Return every command available to the current repo. Resolution order is
 * repo-local files, activated Store files, then dashboard fallback built-ins. Honors
 * the `commands/.disable-builtins` sentinel for fallback built-ins only.
 */
export async function listCommands(
  options: {
    activeStoreSlugs?: Set<string>;
  } = {},
): Promise<CommandFile[]> {
  const { commands: repoCommands, builtinsDisabled } =
    await listRepoCommandFiles();
  const repoSlugs = new Set(repoCommands.map((p) => p.slug));
  const activeStoreSlugs = options.activeStoreSlugs ?? new Set<string>();
  const storeCommands = await listStoreCommandFiles(
    repoSlugs,
    undefined,
    activeStoreSlugs,
  );
  const resolvedSlugs = new Set([
    ...repoCommands.map((p) => p.slug),
    ...storeCommands.map((p) => p.slug),
  ]);

  const builtinsAsFiles: CommandFile[] = builtinsDisabled
    ? []
    : BUILTIN_COMMANDS.filter((b) => !resolvedSlugs.has(b.slug)).map((b) => ({
        slug: b.slug,
        description: b.description,
        argumentHint: b.argumentHint ?? "",
        body: b.body,
        source: "builtin" as const,
        sha: "",
        updatedAt: "",
        htmlUrl: "",
      }));

  return [...repoCommands, ...storeCommands, ...builtinsAsFiles].sort((a, b) =>
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
