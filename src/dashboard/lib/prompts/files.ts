/**
 * @fileType util
 * @domain kody
 * @pattern prompts-files
 * @ai-summary Read/write prompt files under `.kody/prompts/<slug>.md`
 *   via the GitHub contents API. Same shape as `jobs-files.ts`:
 *   filename is the slug, frontmatter holds description/argument-hint,
 *   body is the prompt template that gets substituted with $ARGUMENTS.
 *
 *   A sentinel file `.kody/prompts/.disable-builtins` (any content)
 *   suppresses every built-in prompt for the repo without requiring
 *   per-slug overrides.
 */

import type { Octokit } from "@octokit/rest";
import {
  getOctokit,
  getOwner,
  getRepo,
  invalidatePromptsCache,
} from "../github-client";
import {
  joinFrontmatter,
  splitFrontmatter,
  type PromptFrontmatter,
} from "./frontmatter";

export interface PromptFile {
  /** Filename without `.md` — stable identity, becomes `/<slug>` in chat. */
  slug: string;
  /** One-line description from frontmatter (or empty). */
  description: string;
  /** Argument hint from frontmatter, e.g. `<topic>` (or empty). */
  argumentHint: string;
  /** Prompt body — what gets sent to the model after substitution. */
  body: string;
  /** Source: repo-defined file vs. dashboard built-in. */
  source: "repo" | "builtin";
  /** Git blob sha. Required for update/delete. Empty for built-ins. */
  sha: string;
  /** Last commit timestamp affecting this file. Empty for built-ins. */
  updatedAt: string;
  /** Convenience link to the file on github.com. Empty for built-ins. */
  htmlUrl: string;
}

const PROMPTS_DIR = ".kody/prompts";
const DISABLE_BUILTINS_FILE = ".disable-builtins";

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_"))
    return null;
  return slug;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function buildHtmlUrl(slug: string, branch: string | null): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${PROMPTS_DIR}/${slug}.md`;
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  return data.default_branch;
}

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      per_page: 1,
    });
    return (
      data[0]?.commit.committer?.date ??
      data[0]?.commit.author?.date ??
      new Date().toISOString()
    );
  } catch {
    return new Date().toISOString();
  }
}

function parsePromptMarkdown(raw: string): {
  frontmatter: PromptFrontmatter;
  body: string;
} {
  const { frontmatter, body } = splitFrontmatter(raw);
  return { frontmatter, body: body.replace(/^\s+/, "") };
}

/**
 * List every prompt file under `.kody/prompts/`. Returns `[]` if the
 * directory does not exist. Also returns a flag indicating whether the
 * repo has opted out of built-in prompts.
 */
export async function listRepoPromptFiles(): Promise<{
  prompts: PromptFile[];
  builtinsDisabled: boolean;
}> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: PROMPTS_DIR,
    });
    if (!Array.isArray(data)) return { prompts: [], builtinsDisabled: false };
    entries = data as Array<{ name: string; sha: string; type: string }>;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      return { prompts: [], builtinsDisabled: false };
    }
    throw error;
  }

  const builtinsDisabled = entries.some(
    (e) => e.type === "file" && e.name === DISABLE_BUILTINS_FILE,
  );

  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => ({ slug: slugFromName(e.name), sha: e.sha, name: e.name }))
    .filter(
      (e): e is { slug: string; sha: string; name: string } => e.slug !== null,
    );

  const files = await Promise.all(
    slugs.map(async ({ slug, sha, name }) => {
      try {
        const filePath = `${PROMPTS_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const raw = Buffer.from(data.content, "base64").toString("utf-8");
        const { frontmatter, body } = parsePromptMarkdown(raw);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          description: frontmatter.description ?? "",
          argumentHint: frontmatter.argumentHint ?? "",
          body,
          source: "repo" as const,
          sha,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies PromptFile;
      } catch {
        return null;
      }
    }),
  );

  const nonNull: PromptFile[] = files.filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  nonNull.sort((a, b) => a.slug.localeCompare(b.slug));
  return { prompts: nonNull, builtinsDisabled };
}

export async function readPromptFile(slug: string): Promise<PromptFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${PROMPTS_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const { frontmatter, body } = parsePromptMarkdown(raw);
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      description: frontmatter.description ?? "",
      argumentHint: frontmatter.argumentHint ?? "",
      body,
      source: "repo",
      sha: data.sha,
      updatedAt,
      htmlUrl: buildHtmlUrl(slug, branch),
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  slug: string;
  description: string;
  argumentHint?: string;
  body: string;
  sha?: string;
  message?: string;
}

function buildFileContent(
  opts: Omit<WriteOptions, "octokit" | "sha" | "message">,
): string {
  const frontmatter: PromptFrontmatter = {
    description: opts.description.trim() || undefined,
    argumentHint: opts.argumentHint?.trim() || undefined,
  };
  const body = opts.body.trimStart();
  const ensureTrailingNewline = body.endsWith("\n") ? body : `${body}\n`;
  return joinFrontmatter(frontmatter, ensureTrailingNewline);
}

export async function writePromptFile(opts: WriteOptions): Promise<PromptFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid prompt slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${PROMPTS_DIR}/${opts.slug}.md`;
  const content = buildFileContent(opts);
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(prompts): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidatePromptsCache(opts.slug);
  const refreshed = await readPromptFile(opts.slug);
  if (!refreshed) {
    throw new Error(
      "writePromptFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deletePromptFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid prompt slug: "${slug}".`);
  }
  const existing = await readPromptFile(slug);
  if (!existing) return;
  const filePath = `${PROMPTS_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(prompts): remove ${slug}`,
    sha: existing.sha,
  });
  invalidatePromptsCache(slug);
}
