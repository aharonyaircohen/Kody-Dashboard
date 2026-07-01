/**
 * @fileType util
 * @domain kody
 * @pattern commands-files
 * @ai-summary Read/write consumer command files under `commands/<slug>.md`
 *   in the configured Kody state repo. Same shape as `capabilities-files.ts`:
 *   filename is the slug, frontmatter holds description/argument-hint,
 *   body is the command template that gets substituted with $ARGUMENTS.
 *
 *   A sentinel file `commands/.disable-builtins` (any content)
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
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "../state-repo";
import {
  joinFrontmatter,
  splitFrontmatter,
  type CommandFrontmatter,
} from "./frontmatter";
import {
  buildCompanyStoreBlobUrl,
  companyStoreAssetPath,
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

const COMMANDS_DIR = "commands";
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

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, filePath),
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
 * List every command file under `commands/` in the state repo. Returns `[]` if the
 * directory does not exist. Also returns a flag indicating whether the
 * repo has opted out of built-in commands.
 */
export async function listRepoCommandFiles(): Promise<{
  commands: CommandFile[];
  builtinsDisabled: boolean;
}> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    COMMANDS_DIR,
  );

  const builtinsDisabled = entries.some(
    (e) => e.type === "file" && e.name === DISABLE_BUILTINS_FILE,
  );

  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => ({ slug: slugFromName(e.name), name: e.name }))
    .filter((e): e is { slug: string; name: string } => e.slug !== null);

  const files = await Promise.all(
    slugs.map(async ({ slug, name }) => {
      try {
        const filePath = `${COMMANDS_DIR}/${name}`;
        const file = await readStateText(
          octokit,
          getOwner(),
          getRepo(),
          filePath,
        );
        if (!file) return null;
        const raw = file.content;
        const { frontmatter, body } = parseCommandMarkdown(raw);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          description: frontmatter.description ?? "",
          argumentHint: frontmatter.argumentHint ?? "",
          body,
          source: "repo" as const,
          sha: file.sha,
          updatedAt,
          htmlUrl: file.htmlUrl ?? "",
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
  const filePath = `${COMMANDS_DIR}/${slug}.md`;

  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath);
    if (!file) return null;
    const raw = file.content;
    const { frontmatter, body } = parseCommandMarkdown(raw);
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      description: frontmatter.description ?? "",
      argumentHint: frontmatter.argumentHint ?? "",
      body,
      source: "repo",
      sha: file.sha,
      updatedAt,
      htmlUrl: file.htmlUrl ?? "",
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
  const path = await companyStoreAssetPath(octokit, "commands", `${slug}.md`);
  const raw = await readCompanyStoreText(octokit, path);
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
    htmlUrl: buildCompanyStoreBlobUrl(path),
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

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content,
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
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(commands): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateCommandsCache(slug);
}
