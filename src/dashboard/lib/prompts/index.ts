/**
 * @fileType module
 * @domain kody
 * @pattern prompts-index
 * @ai-summary Public surface for the prompts feature. `listPrompts()`
 *   merges dashboard built-ins with repo-defined `.kody/prompts/*.md`
 *   files. Repo wins on slug collision so a repo can override the
 *   wording of a built-in (e.g. customize `/review` for its codebase).
 *   `.kody/prompts/.disable-builtins` suppresses every built-in for the
 *   repo.
 */

import { BUILTIN_PROMPTS } from "./builtins";
import { listRepoPromptFiles, type PromptFile } from "./files";
import { substitute, type SubstituteResult } from "./substitute";

export type { PromptFile } from "./files";
export type { SubstituteResult } from "./substitute";
export {
  isValidSlug,
  readPromptFile,
  writePromptFile,
  deletePromptFile,
} from "./files";
export { substitute, tokenizeArguments } from "./substitute";
export { BUILTIN_PROMPTS } from "./builtins";

/**
 * Return every prompt available to the current repo (builtins + repo
 * files, with repo overriding builtins by slug). Honors the
 * `.disable-builtins` sentinel.
 */
export async function listPrompts(): Promise<PromptFile[]> {
  const { prompts: repoPrompts, builtinsDisabled } =
    await listRepoPromptFiles();
  const repoSlugs = new Set(repoPrompts.map((p) => p.slug));

  const builtinsAsFiles: PromptFile[] = builtinsDisabled
    ? []
    : BUILTIN_PROMPTS.filter((b) => !repoSlugs.has(b.slug)).map((b) => ({
        slug: b.slug,
        description: b.description,
        argumentHint: b.argumentHint ?? "",
        body: b.body,
        source: "builtin" as const,
        sha: "",
        updatedAt: "",
        htmlUrl: "",
      }));

  return [...builtinsAsFiles, ...repoPrompts].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
}

/**
 * Render a prompt for sending: look up by slug, substitute arguments,
 * and return the final text. Returns `null` if the slug isn't found.
 */
export async function renderPrompt(
  slug: string,
  rawArguments: string,
): Promise<
  (SubstituteResult & { slug: string; source: PromptFile["source"] }) | null
> {
  const all = await listPrompts();
  const prompt = all.find((p) => p.slug === slug);
  if (!prompt) return null;
  const result = substitute(prompt.body, rawArguments);
  return { ...result, slug, source: prompt.source };
}
