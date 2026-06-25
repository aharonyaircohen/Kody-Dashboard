/**
 * @fileOverview Kody Action State Store — GitHub-backed
 * @fileType store
 * @domain kody
 *
 * Stores action polling state in `action-state.json` in the configured
 * Kody state repo via GitHub API.
 * Replaces the old local-FS store that didn't survive Vercel serverless cold starts.
 *
 * Uses SHA-based upsert for safe concurrent writes (createOrUpdateFileContents).
 */

import { createUserOctokit } from "@dashboard/lib/github-client";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import type { Octokit } from "@octokit/rest";

export type ActionStatus = "running" | "waiting" | "complete" | "cancelled";

export interface ActionState {
  runId: string;
  actionId: string;
  sessionId?: string;
  taskId?: string;
  status: ActionStatus;
  step: string;
  instructions: string[];
  cancel: boolean;
  cancelledBy?: string;
  lastHeartbeat: string;
  createdAt: string;
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

// ─── Internal Octokit ─────────────────────────────────────────────────────────

function getOrCreateOctokit(octokit?: Octokit | null): Octokit | null {
  if (octokit) return octokit;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return createUserOctokit(token);
}

// ─── GitHub file helpers ───────────────────────────────────────────────────────

const STORE_FILE = "action-state.json";

/**
 * Per-instance ETag + payload cache for the action-state file.
 *
 * The dashboard polls action state every 20s per open task. Without ETag
 * conditional requests, every poll burns one full GitHub REST quota point
 * — multiple open tabs/tasks drain the shared 5000/hr budget within an hour
 * and the entire dashboard goes dark. With `If-None-Match`, unchanged reads
 * come back as 304 (free, doesn't count against the rate limit), so we
 * only pay quota when state actually changes.
 *
 * The cache stores the raw JSON string (not parsed objects) so each call
 * reparses into a fresh map — mutations by callers (e.g. pollInstruction's
 * `instructions.shift()`) can't poison the cache. Keyed by owner/repo/branch.
 */
const readCache = new Map<string, { etag: string; json: string }>();

function cacheKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}@${branch}`;
}

function parseToMap(json: string): Map<string, ActionState> {
  const map = new Map<string, ActionState>();
  const arr: ActionState[] = JSON.parse(json);
  for (const s of arr) map.set(s.runId, s);
  return map;
}

async function readMap(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<Map<string, ActionState>> {
  const key = cacheKey(owner, repo, branch);
  const cached = readCache.get(key);
  try {
    const file = await readStateText(octokit, owner, repo, STORE_FILE, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const json = file.content;
      if (file.etag) readCache.set(key, { etag: file.etag, json });
      return parseToMap(json);
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    // 304 — file unchanged. Reparse from cached JSON. Does NOT count against the rate limit.
    if (e.status === 304 && cached) return parseToMap(cached.json);
    if (e.status !== 404) throw err;
    // File doesn't exist yet — return empty map
  }
  return new Map<string, ActionState>();
}

/** Invalidate the read cache after a write so the next read picks up changes. */
function invalidateReadCache(
  owner: string,
  repo: string,
  branch: string,
): void {
  readCache.delete(cacheKey(owner, repo, branch));
}

async function writeMap(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  map: Map<string, ActionState>,
  existingSha?: string,
): Promise<void> {
  await writeStateText({
    octokit,
    owner,
    repo,
    path: STORE_FILE,
    message: `kody: update action state`,
    content: JSON.stringify([...map.values()], null, 2),
    ...(existingSha ? { sha: existingSha } : {}),
    maxAttempts: 1,
  });
  // We just changed the file — drop the cached ETag so the next read pulls
  // fresh content (rather than a 304 against the now-stale ETag).
  invalidateReadCache(owner, repo, branch);
}

async function getSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  try {
    const file = await readStateText(octokit, owner, repo, STORE_FILE);
    if (file?.sha) return file.sha;
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status !== 404) throw err;
  }
  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Register or update an action's state. */
export async function upsertActionState(
  update: Partial<ActionState> & { runId: string; actionId: string },
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<ActionState> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit)
    throw new Error("No GitHub token available for action state store");

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  const existing = map.get(update.runId);

  let updated: ActionState;
  if (existing) {
    if (update.actionId !== existing.actionId) return existing; // Reject different instance
    updated = {
      ...existing,
      ...update,
      lastHeartbeat: new Date().toISOString(),
    };
    map.set(update.runId, updated);
  } else {
    updated = {
      runId: update.runId,
      actionId: update.actionId,
      sessionId: update.sessionId,
      taskId: update.taskId,
      status: update.status ?? "running",
      step: update.step ?? "",
      instructions: update.instructions ?? [],
      cancel: false,
      cancelledBy: undefined,
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    map.set(update.runId, updated);
  }

  const sha = existing ? await getSha(octokit, owner, repo, branch) : undefined;
  await writeMap(octokit, owner, repo, branch, map, sha);
  return updated;
}

/** Poll for the next instruction (FIFO). Returns instruction + cancel state. */
export async function pollInstruction(
  runId: string,
  callerActionId: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<{
  instruction: string | null;
  cancel: boolean;
  cancelledBy: string | null;
  actionId: string;
}> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit)
    return {
      instruction: null,
      cancel: false,
      cancelledBy: null,
      actionId: "",
    };

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  const state = map.get(runId);
  if (!state)
    return {
      instruction: null,
      cancel: false,
      cancelledBy: null,
      actionId: "",
    };

  // Dequeue first instruction
  const instruction = state.instructions.shift() ?? null;
  map.set(runId, state);

  const sha = await getSha(octokit, owner, repo, branch);
  await writeMap(octokit, owner, repo, branch, map, sha);

  return {
    instruction,
    cancel: state.cancel,
    cancelledBy: state.cancelledBy ?? null,
    actionId: state.actionId,
  };
}

/** Enqueue an instruction for an action. */
export async function enqueueInstruction(
  runId: string,
  instruction: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<boolean> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return false;

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  const state = map.get(runId);
  if (!state) return false;

  state.instructions.push(instruction);
  map.set(runId, state);

  const sha = await getSha(octokit, owner, repo, branch);
  await writeMap(octokit, owner, repo, branch, map, sha);
  return true;
}

/** Get full state for a runId. */
export async function getActionState(
  runId: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<ActionState | null> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return null;

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  return map.get(runId) ?? null;
}

/** List all action states. */
export async function listActionStates(
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<ActionState[]> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return [];

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  return [...map.values()];
}

/** Cancel an action. */
export async function cancelAction(
  runId: string,
  cancelledBy: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<ActionState | null> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return null;

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  const state = map.get(runId);
  if (!state) return null;

  state.cancel = true;
  state.cancelledBy = cancelledBy;
  map.set(runId, state);

  const sha = await getSha(octokit, owner, repo, branch);
  await writeMap(octokit, owner, repo, branch, map, sha);
  return state;
}

/** Delete an action state. */
export async function deleteActionState(
  runId: string,
  opts: {
    owner?: string;
    repo?: string;
    branch?: string;
    octokit?: Octokit | null;
  } = {},
): Promise<boolean> {
  const octokit = getOrCreateOctokit(opts.octokit);
  if (!octokit) return false;

  const owner = opts.owner ?? getDefaultOwner();
  const repo = opts.repo ?? getDefaultRepo();
  const branch = opts.branch ?? getDefaultBranch();

  const map = await readMap(octokit, owner, repo, branch);
  const deleted = map.delete(runId);
  if (!deleted) return false;

  const sha = await getSha(octokit, owner, repo, branch);
  if (!sha) return false; // Nothing to delete
  await writeMap(octokit, owner, repo, branch, map, sha);
  return true;
}
