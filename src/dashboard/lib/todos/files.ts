/**
 * @fileType util
 * @domain todos
 * @pattern todo-list-files
 * @ai-summary Read/write Kody todo-list files under `todos/<slug>.md`
 * in the configured Kody state repo. Each file is one list; each item is a
 * note-like markdown record with its own completed state.
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
}

export interface TodoFileContent {
  title: string;
  description: string;
  items: TodoItemFile[];
  createdAt: string;
}

export interface TodoFile extends TodoFileContent {
  slug: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

interface TodoFrontmatter {
  title: string;
  createdAt: string;
}

export function isValidTodoSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  return isValidTodoSlug(slug) ? slug : null;
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

function serializeString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (key === "title" && value.trim()) {
      frontmatter.title = value.trim().slice(0, TITLE_MAX_LENGTH);
    } else if (key === "createdAt" && value.trim()) {
      frontmatter.createdAt = value.trim();
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
      };
    })
    .filter((item): item is TodoItemFile => item !== null);
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
  };
}

export function serializeTodoFileContent(content: TodoFileContent): string {
  const description = normalizeMarkdown(content.description);
  const lines = [
    "---",
    `title: ${serializeString(content.title.trim().slice(0, TITLE_MAX_LENGTH))}`,
    `createdAt: ${serializeString(content.createdAt)}`,
    "---",
    "",
  ];

  if (description) {
    lines.push(description, "");
  }

  lines.push(
    "<!-- kody-todo-items-json",
    JSON.stringify(normalizeItems(content.items, content.createdAt), null, 2),
    "-->",
    "",
  );

  return lines.join("\n");
}

export async function listTodoFiles(): Promise<TodoFile[]> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    TODOS_DIR,
  );

  const files = await Promise.all(
    entries.map(async (entry) => {
      const slug = slugFromName(entry.name);
      if (!slug) return null;
      return readTodoFile(slug, octokit);
    }),
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
  const filePath = `${TODOS_DIR}/${slug}.md`;

  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath);
    if (!file) return null;

    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    const parsed = parseTodoFileContent(file.content, slug, updatedAt);

    return {
      slug,
      title: parsed.title,
      description: parsed.description,
      items: parsed.items,
      createdAt: parsed.createdAt,
      sha: file.sha,
      updatedAt,
      htmlUrl: file.htmlUrl ?? "",
    };
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
  sha?: string;
  message?: string;
}

export async function writeTodoFile(opts: WriteTodoOptions): Promise<TodoFile> {
  if (!isValidTodoSlug(opts.slug)) {
    throw new Error(`Invalid todo list slug: "${opts.slug}".`);
  }

  const filePath = `${TODOS_DIR}/${opts.slug}.md`;
  const content = serializeTodoFileContent({
    title: opts.title,
    description: opts.description,
    items: opts.items,
    createdAt: opts.createdAt,
  });
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(todos): ${
      opts.sha ? "update" : "add"
    } ${opts.slug}`;

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: normalizedContent,
    sha: opts.sha,
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
  const existing = await readTodoFile(slug, octokit);
  if (!existing) return;

  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: `${TODOS_DIR}/${slug}.md`,
    message: `chore(todos): remove ${slug}`,
    sha: existing.sha,
  });
}
