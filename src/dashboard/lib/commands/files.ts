/**
 * @fileType util
 * @domain kody
 * @pattern commands-files
 * @ai-summary Read/write command files under `.kody/commands/<slug>.md`
 *   via the GitHub contents API. Same shape as `agentResponsibilities-files.ts`:
 *   filename is the slug, frontmatter holds description/argument-hint,
 *   body is the command template that gets substituted with $ARGUMENTS.
 *
 *   A sentinel file `.kody/commands/.disable-builtins` (any content)
 *   suppresses every built-in command for the repo without requiring
 *   per-slug overrides.
 */

import type { Octokit } from "@octokit/rest";
import {
  getOctokit,
  getOwner,
  getRepo,
  invalidateCommandsCache,
} from "../github-client";
import { writeGitHubFileWithRetry } from "@dashboard/lib/github-contents-write";
import {
  joinFrontmatter,
  splitFrontmatter,
  type CommandFrontmatter,
} from "./frontmatter";
import {
  buildCompanyStoreBlobUrl,
  companyStoreUpdatedAt,
  listCompanyStoreMarkdownAssetSlugs,
  readCompanyStoreText,
} from "../company-store/assets";

export interface CommandFile {
  /** Filename without `.md` — stable identity, becomes `/<slug>` in chat. */
  slug: string;
  /** One-line description from frontmatter (or empty). */
  description: string;
  /** Argument hint from frontmatter, e.g. `<topic>` (or empty). */
  argumentHint: string;
  /** Command body — what gets sent to the model after substitution. */
  body: string;
  /** Source: repo-defined file, company store, or dashboard built-in. */
  source: "repo" | "store" | "builtin";
  /** Git blob sha. Required for update/delete. Empty for built-ins. */
  sha: string;
  /** Last commit timestamp affecting this file. Empty for built-ins. */
  updatedAt: string;
  /** Convenience link to the file on github.com. Empty for built-ins. */
  htmlUrl: string;
}

const COMMANDS_DIR = ".kody/commands";
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
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${COMMANDS_DIR}/${slug}.md`;
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

function parseCommandMarkdown(raw: string): {
  frontmatter: CommandFrontmatter;
  body: string;
} {
  const { frontmatter, body } = splitFrontmatter(raw);
  return { frontmatter, body: body.replace(/^\s+/, "") };
}

/**
 * List every command file under `.kody/commands/`. Returns `[]` if the
 * directory does not exist. Also returns a flag indicating whether the
 * repo has opted out of built-in commands.
 */
export async function listRepoCommandFiles(): Promise<{
  commands: CommandFile[];
  builtinsDisabled: boolean;
}> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: COMMANDS_DIR,
    });
    if (!Array.isArray(data)) return { commands: [], builtinsDisabled: false };
    entries = data as Array<{ name: string; sha: string; type: string }>;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      return { commands: [], builtinsDisabled: false };
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
        const filePath = `${COMMANDS_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const raw = Buffer.from(data.content, "base64").toString("utf-8");
        const { frontmatter, body } = parseCommandMarkdown(raw);
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
        } satisfies CommandFile;
      } catch {
        return null;
      }
    }),
  );

  const nonNull: CommandFile[] = files.filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  nonNull.sort((a, b) => a.slug.localeCompare(b.slug));
  return { commands: nonNull, builtinsDisabled };
}

export async function readCommandFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<CommandFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${COMMANDS_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const { frontmatter, body } = parseCommandMarkdown(raw);
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

export async function listStoreCommandFiles(
  localSlugs: Set<string> = new Set(),
  octokitOverride?: Octokit,
  activeStoreSlugs?: Set<string>,
): Promise<CommandFile[]> {
  const octokit = octokitOverride ?? getOctokit();
  const slugs = await listCompanyStoreMarkdownAssetSlugs(
    octokit,
    "commands",
    isValidSlug,
  );
  const files = await Promise.all(
    slugs
      .filter((slug) => !localSlugs.has(slug))
      .filter((slug) => !activeStoreSlugs || activeStoreSlugs.has(slug))
      .map((slug) => readStoreCommandFile(slug, octokit)),
  );
  return files.filter((file): file is CommandFile => file !== null);
}

export async function readStoreCommandFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<CommandFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const raw = await readCompanyStoreText(octokit, `${COMMANDS_DIR}/${slug}.md`);
  if (raw === null) return null;
  const { frontmatter, body } = parseCommandMarkdown(raw);
  const updatedAt = await companyStoreUpdatedAt(octokit, "commands", slug);
  return {
    slug,
    description: frontmatter.description ?? "",
    argumentHint: frontmatter.argumentHint ?? "",
    body,
    source: "store",
    sha: "",
    updatedAt: updatedAt === "1970-01-01T00:00:00.000Z" ? "" : updatedAt,
    htmlUrl: buildCompanyStoreBlobUrl(`${COMMANDS_DIR}/${slug}.md`),
  };
}

export async function readResolvedCommandFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<CommandFile | null> {
  const repo = await readCommandFile(slug, octokitOverride);
  if (repo) return repo;
  return readStoreCommandFile(slug, octokitOverride);
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
  const frontmatter: CommandFrontmatter = {
    description: opts.description.trim() || undefined,
    argumentHint: opts.argumentHint?.trim() || undefined,
  };
  const body = opts.body.trimStart();
  const ensureTrailingNewline = body.endsWith("\n") ? body : `${body}\n`;
  return joinFrontmatter(frontmatter, ensureTrailingNewline);
}

export async function writeCommandFile(
  opts: WriteOptions,
): Promise<CommandFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid command slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${COMMANDS_DIR}/${opts.slug}.md`;
  const content = buildFileContent(opts);
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(commands): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await writeGitHubFileWithRetry(opts.octokit, {
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateCommandsCache(opts.slug);
  // Confirm with the same octokit that wrote — not the per-request global,
  // which a concurrent request may have cleared (→ 401 "Bad credentials").
  const refreshed = await readCommandFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeCommandFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteCommandFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid command slug: "${slug}".`);
  }
  const existing = await readCommandFile(slug);
  if (!existing) return;
  const filePath = `${COMMANDS_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(commands): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateCommandsCache(slug);
}
