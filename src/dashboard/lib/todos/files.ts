/**
 * @fileType util
 * @domain todos
 * @pattern todo-list-files
 * @ai-summary Read/write Kody todo-list JSON files under `todos/<slug>.json`
 * in the configured Kody state repo. Each file is one list.
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
import { slugifyTitle } from "../slug";

const TODOS_DIR = "todos";
const TODO_JSON_VERSION = 1;
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

export function isValidTodoSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const slug = name.slice(0, -".json".length);
  return isValidTodoSlug(slug) ? slug : null;
}

function todoJsonPath(slug: string): string {
  return `${TODOS_DIR}/${slug}.json`;
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

function normalizeMarkdown(value: string): string {
  return value.slice(0, BODY_MAX_LENGTH).trim();
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

export function parseTodoFileContent(
  raw: string,
  slug: string,
  updatedAt: string,
): TodoFileContent {
  return (
    parseTodoJsonFileContent(raw, slug, updatedAt) ?? {
      title: slug,
      description: "",
      items: [],
      createdAt: updatedAt,
      frontmatter: { title: slug, createdAt: updatedAt },
    }
  );
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

  const slugs = new Set<string>();
  for (const entry of entries) {
    const slug = slugFromName(entry.name);
    if (slug) slugs.add(slug);
  }

  const files = await Promise.all(
    Array.from(slugs).map((slug) => readTodoFile(slug, octokit)),
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
    const filePath = todoJsonPath(slug);
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath);
    if (!file) return null;

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
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export async function createTodoSlug(title: string): Promise<string> {
  const base = slugifyTitle(title, {
    maxLength: 48,
    fallback: "todo-list",
    stripDiacritics: true,
  });
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

  const writeResult = await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: normalizedContent,
    sha: existingJson ? (opts.sha ?? existingJson.sha) : undefined,
  });

  const updatedAt = new Date().toISOString();
  const parsed = parseTodoFileContent(normalizedContent, opts.slug, updatedAt);
  return {
    slug: opts.slug,
    path: filePath,
    title: parsed.title,
    description: parsed.description,
    items: parsed.items,
    createdAt: parsed.createdAt,
    frontmatter: parsed.frontmatter,
    sha: writeResult.sha ?? existingJson?.sha ?? opts.sha ?? "",
    updatedAt,
    htmlUrl: writeResult.htmlUrl ?? existingJson?.htmlUrl ?? "",
  };
}

export async function deleteTodoFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidTodoSlug(slug)) {
    throw new Error(`Invalid todo list slug: "${slug}".`);
  }
  const path = todoJsonPath(slug);
  const existing = await readStateText(octokit, getOwner(), getRepo(), path);
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path,
    message: `chore(todos): remove ${slug}`,
    sha: existing.sha,
  });
}
