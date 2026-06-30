/**
 * @fileType util
 * @domain todos
 * @pattern todo-list-files
 * @ai-summary Read/write Kody todo-list files under `todos/<slug>.json`
 * in the configured Kody state repo. Each file is one list; legacy markdown
 * files are still readable during migration.
 */
import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "../state-repo";

const TODOS_DIR = "todos";
const TODO_JSON_VERSION = 1;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ITEMS_BLOCK_RE = /<!--\s*kody-todo-items-json\s*\r?\n([\s\S]*?)\r?\n-->/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TITLE_MAX_LENGTH = 160;
const BODY_MAX_LENGTH = 20_000;

export interface TodoItemFile {
  id: string;
  title: string;
  body: string;
  assignee: string | null;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  meta?: Record<string, unknown>;
}

export interface TodoFileContent {
  title: string;
  description: string;
  items: TodoItemFile[];
  createdAt: string;
  frontmatter?: Record<string, unknown>;
}

export interface TodoFile extends TodoFileContent {
  slug: string;
  path: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

interface TodoFrontmatter {
  title: string;
  createdAt: string;
  [key: string]: unknown;
}

export function isValidTodoSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

type TodoFileFormat = "json" | "markdown";

function slugFromName(
  name: string,
): { slug: string; format: TodoFileFormat } | null {
  if (name.endsWith(".json")) {
    const slug = name.slice(0, -".json".length);
    return isValidTodoSlug(slug) ? { slug, format: "json" } : null;
  }
  if (name.endsWith(".md")) {
    const slug = name.slice(0, -".md".length);
    return isValidTodoSlug(slug) ? { slug, format: "markdown" } : null;
  }
  return null;
}

function todoJsonPath(slug: string): string {
  return `${TODOS_DIR}/${slug}.json`;
}

function legacyTodoMarkdownPath(slug: string): string {
  return `${TODOS_DIR}/${slug}.md`;
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "todo-list";
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

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function parseFrontmatterValue(value: string): unknown {
  const stripped = stripQuotes(value.trim());
  if (!stripped) return "";
  if (stripped === "true") return true;
  if (stripped === "false") return false;
  if (stripped === "null") return null;
  if (
    stripped.startsWith("{") ||
    stripped.startsWith("[") ||
    /^-?\d+(\.\d+)?$/.test(stripped)
  ) {
    try {
      return JSON.parse(stripped);
    } catch {
      return stripped;
    }
  }
  return stripped;
}

function normalizeMarkdown(value: string): string {
  return value.slice(0, BODY_MAX_LENGTH).trim();
}

function parseFrontmatter(
  raw: string,
  slug: string,
  updatedAt: string,
): { frontmatter: TodoFrontmatter; markdown: string } {
  const fallback: TodoFrontmatter = {
    title: slug,
    createdAt: updatedAt,
  };
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: fallback, markdown: raw };

  const frontmatter = { ...fallback };
  const inner = match[1] ?? "";
  for (const rawLine of inner.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    const value = parseFrontmatterValue(line.slice(colon + 1).trim());
    if (key === "title" && String(value).trim()) {
      frontmatter.title = String(value).trim().slice(0, TITLE_MAX_LENGTH);
    } else if (key === "createdAt" && String(value).trim()) {
      frontmatter.createdAt = String(value).trim();
    } else {
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    markdown: raw.slice(match[0].length).replace(/^\s+/, ""),
  };
}

function generatedItemId(): string {
  return `item-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeItems(items: unknown, fallbackDate: string): TodoItemFile[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item): TodoItemFile | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!title) return null;
      const completed = record.completed === true;
      return {
        id:
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim().slice(0, 80)
            : generatedItemId(),
        title: title.slice(0, TITLE_MAX_LENGTH),
        body:
          typeof record.body === "string"
            ? record.body.slice(0, BODY_MAX_LENGTH)
            : "",
        assignee:
          typeof record.assignee === "string" && record.assignee.trim()
            ? record.assignee.trim().replace(/^@+/, "").slice(0, 120)
            : null,
        completed,
        createdAt:
          typeof record.createdAt === "string" && record.createdAt.trim()
            ? record.createdAt.trim()
            : fallbackDate,
        completedAt:
          completed &&
          typeof record.completedAt === "string" &&
          record.completedAt.trim()
            ? record.completedAt.trim()
            : null,
        ...(record.meta &&
        typeof record.meta === "object" &&
        !Array.isArray(record.meta)
          ? { meta: record.meta as Record<string, unknown> }
          : {}),
      };
    })
    .filter((item): item is TodoItemFile => item !== null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseItems(markdown: string, fallbackDate: string): TodoItemFile[] {
  const match = ITEMS_BLOCK_RE.exec(markdown);
  if (!match) return [];

  try {
    return normalizeItems(JSON.parse(match[1] ?? "[]"), fallbackDate);
  } catch {
    return [];
  }
}

function parseLegacyTodo(
  frontmatter: TodoFrontmatter,
  markdown: string,
  fallbackDate: string,
): TodoItemFile[] {
  const body = markdown.replace(ITEMS_BLOCK_RE, "").trim();
  if (!body) return [];
  return [
    {
      id: generatedItemId(),
      title: frontmatter.title,
      body,
      assignee: null,
      completed: false,
      createdAt: fallbackDate,
      completedAt: null,
    },
  ];
}

function extractDescription(markdown: string): string {
  return normalizeMarkdown(markdown.replace(ITEMS_BLOCK_RE, ""));
}

export function parseTodoFileContent(
  raw: string,
  slug: string,
  updatedAt: string,
): TodoFileContent {
  const json = parseTodoJsonFileContent(raw, slug, updatedAt);
  if (json) return json;

  const { frontmatter, markdown } = parseFrontmatter(raw, slug, updatedAt);
  const hasItemsBlock = ITEMS_BLOCK_RE.test(markdown);
  const items = hasItemsBlock
    ? parseItems(markdown, frontmatter.createdAt)
    : parseLegacyTodo(frontmatter, markdown, frontmatter.createdAt);

  return {
    title: frontmatter.title,
    description: hasItemsBlock ? extractDescription(markdown) : "",
    items,
    createdAt: frontmatter.createdAt,
    frontmatter,
  };
}

function parseTodoJsonFileContent(
  raw: string,
  slug: string,
  updatedAt: string,
): TodoFileContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;

  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim().slice(0, TITLE_MAX_LENGTH)
      : slug;
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt.trim()
      : updatedAt;
  const frontmatter: Record<string, unknown> = {
    ...(asRecord(record.frontmatter) ?? {}),
  };
  for (const [key, value] of Object.entries(record)) {
    if (key === "description" || key === "items" || key === "frontmatter") {
      continue;
    }
    frontmatter[key] = value;
  }
  frontmatter.title = title;
  frontmatter.createdAt = createdAt;

  return {
    title,
    description:
      typeof record.description === "string"
        ? normalizeMarkdown(record.description)
        : "",
    items: normalizeItems(record.items, createdAt),
    createdAt,
    frontmatter,
  };
}

export function serializeTodoFileContent(content: TodoFileContent): string {
  const description = normalizeMarkdown(content.description);
  const frontmatter = {
    ...(content.frontmatter ?? {}),
    title: content.title.trim().slice(0, TITLE_MAX_LENGTH),
    createdAt: content.createdAt,
  };
  return `${JSON.stringify(
    {
      version: TODO_JSON_VERSION,
      ...frontmatter,
      title: frontmatter.title,
      description,
      createdAt: frontmatter.createdAt,
      items: normalizeItems(content.items, content.createdAt),
    },
    null,
    2,
  )}\n`;
}

export async function listTodoFiles(): Promise<TodoFile[]> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    TODOS_DIR,
  );

  const slugs = new Map<string, TodoFileFormat>();
  for (const entry of entries) {
    const parsed = slugFromName(entry.name);
    if (!parsed) continue;
    if (parsed.format === "json" || !slugs.has(parsed.slug)) {
      slugs.set(parsed.slug, parsed.format);
    }
  }

  const files = await Promise.all(
    Array.from(slugs.keys()).map((slug) => readTodoFile(slug, octokit)),
  );

  return files
    .filter((file): file is TodoFile => file !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readTodoFile(
  slug: string,
  octokitOverride?: Octokit,
  _branchOverride?: string | null,
): Promise<TodoFile | null> {
  if (!isValidTodoSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();

  try {
    const candidates = [todoJsonPath(slug), legacyTodoMarkdownPath(slug)];
    for (const filePath of candidates) {
      const file = await readStateText(octokit, getOwner(), getRepo(), filePath);
      if (!file) continue;

      const updatedAt = await fetchLastCommitDate(octokit, filePath);
      const parsed = parseTodoFileContent(file.content, slug, updatedAt);

      return {
        slug,
        path: filePath,
        title: parsed.title,
        description: parsed.description,
        items: parsed.items,
        createdAt: parsed.createdAt,
        frontmatter: parsed.frontmatter,
        sha: file.sha,
        updatedAt,
        htmlUrl: file.htmlUrl ?? "",
      };
    }
    return null;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export async function createTodoSlug(title: string): Promise<string> {
  const base = slugifyTitle(title);
  const suffix = Date.now().toString(36);

  for (let index = 0; index < 20; index += 1) {
    const candidate =
      index === 0
        ? base
        : `${base.slice(0, Math.max(1, 55 - String(index).length))}-${index}`;
    if (!(await readTodoFile(candidate))) return candidate;
  }

  return `${base.slice(0, 50)}-${suffix}`.slice(0, 64);
}

interface WriteTodoOptions {
  octokit: Octokit;
  slug: string;
  title: string;
  description: string;
  items: TodoItemFile[];
  createdAt: string;
  frontmatter?: Record<string, unknown>;
  sha?: string;
  message?: string;
}

export async function writeTodoFile(opts: WriteTodoOptions): Promise<TodoFile> {
  if (!isValidTodoSlug(opts.slug)) {
    throw new Error(`Invalid todo list slug: "${opts.slug}".`);
  }

  const filePath = todoJsonPath(opts.slug);
  const content = serializeTodoFileContent({
    title: opts.title,
    description: opts.description,
    items: opts.items,
    createdAt: opts.createdAt,
    frontmatter: opts.frontmatter,
  });
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(todos): ${
      opts.sha ? "update" : "add"
    } ${opts.slug}`;

  const existingJson = await readStateText(
    opts.octokit,
    getOwner(),
    getRepo(),
    filePath,
  );

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: normalizedContent,
    sha: existingJson ? (opts.sha ?? existingJson.sha) : undefined,
  });

  const refreshed = await readTodoFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error("writeTodoFile: file was written but could not be re-read");
  }
  return refreshed;
}

export async function deleteTodoFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidTodoSlug(slug)) {
    throw new Error(`Invalid todo list slug: "${slug}".`);
  }
  const paths = [todoJsonPath(slug), legacyTodoMarkdownPath(slug)];
  for (const path of paths) {
    const existing = await readStateText(octokit, getOwner(), getRepo(), path);
    if (!existing) continue;
    await deleteStateFile({
      octokit,
      owner: getOwner(),
      repo: getRepo(),
      path,
      message: `chore(todos): remove ${slug}`,
      sha: existing.sha,
    });
  }
}
