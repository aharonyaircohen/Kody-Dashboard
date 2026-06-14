/**
 * @fileOverview Kody Event Log Store — GitHub-backed
 * @fileType store
 * @domain kody
 *
 * Append-only event log stored in `.kody/event-log.jsonl` in the repo via GitHub API.
 * Each line is a JSON-encoded EventLogEntry. The full file is kept under 10k entries
 * by trimming on read (oldest entries trimmed first).
 *
 * Replaces the old local-FS store that didn't survive Vercel serverless cold starts.
 */

import { createUserOctokit } from "@dashboard/lib/github-client";
import type { Octokit } from "@octokit/rest";

export interface EventLogEntry {
  id: string;
  runId: string;
  event: string;
  payload: Record<string, unknown>;
  channel?: string;
  actionState?: { status: string; step: string; sessionId?: string };
  emittedAt: string;
}

// ─── Repo config ───────────────────────────────────────────────────────────────

function getDefaultOwner(): string {
  return process.env.GITHUB_OWNER ?? "aharonyaircohen";
}

function getDefaultRepo(): string {
  return process.env.GITHUB_REPO ?? "Kody-Dashboard";
}

function getDefaultBranch(): string {
  return process.env.KODY_STORE_BRANCH ?? "main";
}

function getOrCreateOctokit(octokit?: Octokit | null): Octokit | null {
  if (octokit) return octokit;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return createUserOctokit(token);
}

const STORE_FILE = ".kody/event-log.jsonl";
const MAX_ENTRIES = 10000;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── GitHub file helpers ───────────────────────────────────────────────────────

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ content: string; sha?: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: STORE_FILE,
      ref: branch,
    });
    if ("content" in data && data.content) {
      return {
        content: Buffer.from(data.content, "base64").toString("utf-8"),
        sha: data.sha as string,
      };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status !== 404) throw err;
  }
  return null;
}

async function writeFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  content: string,
  sha?: string,
): Promise<void> {
  const encoded = Buffer.from(content).toString("base64");
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: STORE_FILE,
    message: `kody: append event log`,
    content: encoded,
    branch,
    ...(sha ? { sha } : {}),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Append an event entry to the log. */
export async function logEvent(
  event: string,
  payload: Record<string, unknown>,
  actionState?: EventLogEntry["actionState"],
  channel = "pipeline",
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<EventLogEntry> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit)
    throw new Error("No GitHub token available for event log store");

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const entry: EventLogEntry = {
    id: generateId(),
    runId: (payload.runId as string) ?? "unknown",
    event,
    payload,
    actionState,
    channel,
    emittedAt: new Date().toISOString(),
  };

  const newLine = JSON.stringify(entry) + "\n";
  const existing = await getFileContent(octokit, owner, repo, branch);

  let finalContent: string;
  if (existing) {
    const lines = existing.content.trim().split("\n").filter(Boolean);
    // Trim oldest entries if we're approaching the limit
    if (lines.length >= MAX_ENTRIES) {
      lines.splice(0, lines.length - MAX_ENTRIES + 1);
    }
    finalContent =
      [...lines, entry].map((e) => JSON.stringify(e)).join("\n") + "\n";
  } else {
    finalContent = newLine;
  }

  await writeFile(octokit, owner, repo, branch, finalContent, existing?.sha);
  return entry;
}

/** Get all events for a runId. */
export async function getEventHistory(
  runId: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<EventLogEntry[]> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return [];

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const existing = await getFileContent(octokit, owner, repo, branch);
  if (!existing) return [];

  return existing.content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as EventLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is EventLogEntry => e !== null && e.runId === runId);
}

/** Get all events (no filter). */
export async function getAllEvents(
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<EventLogEntry[]> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return [];

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const existing = await getFileContent(octokit, owner, repo, branch);
  if (!existing) return [];

  return existing.content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as EventLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is EventLogEntry => e !== null);
}

/** Get the most recent event for a runId. */
export async function getLastEvent(
  runId: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<EventLogEntry | null> {
  const history = await getEventHistory(runId, opts);
  return history.at(-1) ?? null;
}
