/**
 * @fileType utility
 * @domain kody
 * @pattern memory-files
 * @ai-summary Memory file storage — read/write `memory/<id>.md` and
 *   `memory/INDEX.md` in the configured Kody state repo. Mirrors the capabilities-
 *   files pattern: filename is identity, body is markdown, frontmatter
 *   carries metadata (name, description, type, created). The INDEX file
 *   is a one-line-per-entry pointer file injected into the chat system
 *   prompt every turn so the agent can decide whether a new memory would
 *   be a duplicate or an update.
 *
 *   Memory types follow the same model as the Claude harness's auto-memory:
 *     - user      facts about the requester's role / preferences
 *     - feedback  guidance on how to approach work in this repo
 *     - project   ongoing initiatives, decisions, deadlines
 *     - reference pointers into external systems (Linear, Slack, Grafana, …)
 */

import type { Octokit } from "@octokit/rest";
import {
  getOctokit,
  getOwner,
  getRepo,
  invalidateMemoryCache,
} from "./github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "./state-repo";
import { slugifyTitle } from "./slug";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFrontmatter {
  /** Short title for the memory (one line, ~40 chars). */
  name: string;
  /** One-line hook surfaced in INDEX.md. ~150 chars. */
  description: string;
  /** Memory category — see module docstring. */
  type: MemoryType;
  /** ISO 8601 timestamp at which the memory was first written. */
  created: string;
}

export interface MemoryFile {
  /** Filename without `.md` — stable identity. Lowercase letters, digits, dashes, underscores. */
  id: string;
  /** Frontmatter values (validated). */
  meta: MemoryFrontmatter;
  /** Markdown body — everything after the closing `---`. */
  body: string;
  /** Git blob sha. Required for update/delete. Returned by reads only. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

const MEMORY_DIR = "memory";
const INDEX_FILE = "INDEX.md";
const MEMORY_TYPES: readonly MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidMemoryId(id: string): boolean {
  return ID_RE.test(id);
}

/**
 * Slugify a free-text memory name into a valid id. Strips non-alphanum,
 * collapses dashes, lowercases, caps at 64 chars. Caller should still
 * check `isValidMemoryId` (e.g. an empty input returns "").
 */
export function slugifyMemoryName(name: string): string {
  return slugifyTitle(name);
}

function isMemoryType(value: unknown): value is MemoryType {
  return (
    typeof value === "string" &&
    (MEMORY_TYPES as readonly string[]).includes(value)
  );
}

// ---------- Frontmatter ----------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface RawFrontmatter {
  name?: string;
  description?: string;
  type?: string;
  created?: string;
}

/**
 * Tiny scalar-only YAML parser, scoped to memory frontmatter. We keep the
 * surface small on purpose — the Kody capabilities frontmatter helper has a similar
 * design. Strings may be unquoted, single-quoted, or double-quoted; values
 * with special characters (`:`, `#`, leading whitespace) MUST be quoted.
 */
function parseFlatYaml(input: string): RawFrontmatter {
  const out: RawFrontmatter = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "name") out.name = value;
    else if (key === "description") out.description = value;
    else if (key === "type") out.type = value;
    else if (key === "created") out.created = value;
  }
  return out;
}

function escapeYamlString(value: string): string {
  // Quote if the value contains special characters that would break a flat
  // scalar parse. Always quote to keep the format predictable across edits.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildFileContent(meta: MemoryFrontmatter, body: string): string {
  const trimmed = body.replace(/^\s+/, "").replace(/\s+$/, "");
  const fm = [
    "---",
    `name: ${escapeYamlString(meta.name)}`,
    `description: ${escapeYamlString(meta.description)}`,
    `type: ${meta.type}`,
    `created: ${meta.created}`,
    "---",
    "",
  ].join("\n");
  return `${fm}\n${trimmed}\n`;
}

function splitFrontmatter(raw: string): { meta: RawFrontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { meta: parseFlatYaml(inner), body };
}

function parseMemoryFile(
  raw: string,
  id: string,
): { meta: MemoryFrontmatter; body: string } | null {
  const { meta: rawMeta, body } = splitFrontmatter(raw);
  if (
    !rawMeta.name ||
    !rawMeta.description ||
    !rawMeta.created ||
    !isMemoryType(rawMeta.type)
  ) {
    return null;
  }
  return {
    meta: {
      name: rawMeta.name,
      description: rawMeta.description,
      type: rawMeta.type,
      created: rawMeta.created,
    },
    body: body.trim(),
  };
}

// ---------- GitHub helpers ----------

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

// ---------- List / Read ----------

/**
 * List every memory file under `memory/` in the state repo, excluding INDEX.md.
 * Returns `[]` if the directory does not exist (fresh repo).
 */
export async function listMemoryFiles(): Promise<MemoryFile[]> {
  const octokit = getOctokit();

  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    MEMORY_DIR,
    { headers: { "If-None-Match": "" } },
  );

  const ids = entries
    .filter(
      (e) =>
        e.type === "file" && e.name.endsWith(".md") && e.name !== INDEX_FILE,
    )
    .map((e) => ({
      id: e.name.slice(0, -".md".length),
      name: e.name,
    }))
    .filter((e) => isValidMemoryId(e.id));

  const files = await Promise.all(
    ids.map(async ({ id, name }) => {
      try {
        const filePath = `${MEMORY_DIR}/${name}`;
        const file = await readStateText(
          octokit,
          getOwner(),
          getRepo(),
          filePath,
          { headers: { "If-None-Match": "" } },
        );
        if (!file) return null;
        const raw = file.content;
        const parsed = parseMemoryFile(raw, id);
        if (!parsed) return null;
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          id,
          meta: parsed.meta,
          body: parsed.body,
          sha: file.sha,
          updatedAt,
          htmlUrl: file.htmlUrl ?? "",
        } satisfies MemoryFile;
      } catch {
        return null;
      }
    }),
  );

  return files
    .filter((f): f is MemoryFile => f !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Read a single memory file by id. Returns `null` if the file does not
 * exist or its frontmatter is malformed.
 */
export async function readMemoryFile(id: string): Promise<MemoryFile | null> {
  if (!isValidMemoryId(id)) return null;
  const octokit = getOctokit();
  const filePath = `${MEMORY_DIR}/${id}.md`;
  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath, {
      headers: { "If-None-Match": "" },
    });
    if (!file) return null;
    const parsed = parseMemoryFile(file.content, id);
    if (!parsed) return null;
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      id,
      meta: parsed.meta,
      body: parsed.body,
      sha: file.sha,
      updatedAt,
      htmlUrl: file.htmlUrl ?? "",
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

// ---------- Index ----------

/**
 * Read `memory/INDEX.md` from the state repo. Returns the raw markdown body (no
 * frontmatter — the index is plain markdown), or `null` if missing.
 * The system-prompt builder injects this verbatim under a
 * `## Remembered context` heading.
 */
export async function readMemoryIndex(): Promise<{
  body: string;
  sha: string;
} | null> {
  const octokit = getOctokit();
  const filePath = `${MEMORY_DIR}/${INDEX_FILE}`;
  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath, {
      headers: { "If-None-Match": "" },
    });
    if (!file) return null;
    return { body: file.content, sha: file.sha };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    return null;
  }
}

function indexHeader(): string {
  return [
    "# Kody memory index",
    "",
    "One line per memory. The chat agent maintains this file — do not edit by hand.",
    "Each entry: `- [Title](id.md) — one-line hook (type: <type>)`.",
    "",
  ].join("\n");
}

function renderIndexLine(file: {
  id: string;
  meta: MemoryFrontmatter;
}): string {
  return `- [${file.meta.name}](${file.id}.md) — ${file.meta.description} (type: ${file.meta.type})`;
}

function buildIndexBody(files: MemoryFile[]): string {
  const sorted = [...files].sort((a, b) => {
    if (a.meta.type !== b.meta.type) {
      return (
        MEMORY_TYPES.indexOf(a.meta.type) - MEMORY_TYPES.indexOf(b.meta.type)
      );
    }
    return a.id.localeCompare(b.id);
  });
  return `${indexHeader()}${sorted.map(renderIndexLine).join("\n")}\n`;
}

/**
 * Rebuild INDEX.md from the live directory listing and commit it.
 * Idempotent — if the body matches the current sha, the commit is skipped.
 */
async function rebuildAndWriteIndex(opts: {
  octokit: Octokit;
  message: string;
}): Promise<void> {
  const { octokit, message } = opts;
  const files = await listMemoryFiles();
  const body = buildIndexBody(files);
  const existing = await readMemoryIndex();
  if (existing && existing.body === body) return;
  await writeStateText({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: `${MEMORY_DIR}/${INDEX_FILE}`,
    message,
    content: body,
    sha: existing?.sha,
  });
}

// ---------- Write / Delete ----------

interface WriteOptions {
  octokit: Octokit;
  id: string;
  meta: MemoryFrontmatter;
  body: string;
  /** SHA of the existing blob; omit on create. */
  sha?: string;
  /** Commit message override. */
  message?: string;
}

/**
 * Create or update a memory file, then rebuild INDEX.md. Returns the
 * refreshed MemoryFile record.
 */
export async function writeMemoryFile(opts: WriteOptions): Promise<MemoryFile> {
  if (!isValidMemoryId(opts.id)) {
    throw new Error(
      `Invalid memory id: "${opts.id}". Use lowercase letters, digits, dashes, underscores (max 64 chars).`,
    );
  }
  if (!isMemoryType(opts.meta.type)) {
    throw new Error(
      `Invalid memory type: "${opts.meta.type}". Use one of ${MEMORY_TYPES.join(", ")}.`,
    );
  }
  const filePath = `${MEMORY_DIR}/${opts.id}.md`;
  const content = buildFileContent(opts.meta, opts.body);
  const verb = opts.sha ? "update" : "add";
  const message = opts.message ?? `chore(memory): ${verb} ${opts.id}`;

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content,
    sha: opts.sha,
  });
  invalidateMemoryCache(opts.id);

  await rebuildAndWriteIndex({
    octokit: opts.octokit,
    message: `chore(memory): refresh INDEX after ${verb} ${opts.id}`,
  }).catch(() => {
    // Index rebuild is best-effort; per-memory files are source of truth.
  });

  const refreshed = await readMemoryFile(opts.id);
  if (!refreshed) {
    throw new Error(
      "writeMemoryFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}
export async function deleteMemoryFile(
  octokit: Octokit,
  id: string,
): Promise<void> {
  if (!isValidMemoryId(id)) {
    throw new Error(`Invalid memory id: "${id}".`);
  }
  const existing = await readMemoryFile(id);
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: `${MEMORY_DIR}/${id}.md`,
    message: `chore(memory): remove ${id}`,
    sha: existing.sha,
  });
  invalidateMemoryCache(id);
  await rebuildAndWriteIndex({
    octokit,
    message: `chore(memory): refresh INDEX after remove ${id}`,
  }).catch(() => {
    /* best-effort */
  });
}
// ---------- Cached system-prompt loader ----------

interface CachedIndex {
  body: string;
  expiresAt: number;
}

const indexCache = new Map<string, CachedIndex>();
const INDEX_CACHE_TTL_MS = 60_000;

function indexCacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Load the memory index for the current request's repo, with a 60-second
 * in-process cache so chat turns don't pay a GitHub round-trip per turn.
 * Returns `null` when the index file is absent (fresh repo / never used).
 */
export async function loadMemoryIndexForPrompt(): Promise<string | null> {
  const key = indexCacheKey();
  const cached = indexCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.body || null;

  const result = await readMemoryIndex();
  const body = result?.body ?? "";
  indexCache.set(key, { body, expiresAt: Date.now() + INDEX_CACHE_TTL_MS });
  return body || null;
}

/**
 * Wipe the in-process index cache for the current repo. The memory tools
 * call this after any write so the next chat turn re-fetches.
 */
export function invalidateMemoryIndexPromptCache(): void {
  indexCache.delete(indexCacheKey());
}

export { MEMORY_DIR, MEMORY_TYPES };
