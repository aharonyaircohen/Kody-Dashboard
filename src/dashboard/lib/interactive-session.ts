/**
 * @fileType util
 * @domain kody
 * @pattern interactive-session
 *
 * Server-side helpers for the long-lived "interactive runner" chat mode.
 * The mode is gated by a meta line at the top of the session JSONL — see
 * kody2/src/chat/session.ts (readMeta). The runner enters a poll loop
 * instead of replying once and exiting.
 *
 * Why this lives in its own module: the existing trigger route does
 * dispatch-per-turn and assumes one workflow run = one reply. Interactive
 * mode breaks that — start() dispatches once, then append() writes to the
 * session file in the configured Kody state repo without triggering anything
 * new.
 *
 * Auth model is the same inline HMAC token as one-shot chat — see
 * chat-token.ts. The runner verifies the token on ingest POSTs so we
 * don't need a shared session-state DB.
 */

import type { Octokit } from "@octokit/rest";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

const SESSION_DIR = "sessions";
const DEFAULT_BRANCH = "main";

/** Meta line written as the first JSONL row. The engine reads it via readMeta. */
export interface SessionMeta {
  type: "meta";
  mode: "interactive";
  createdAt: string;
  /** Idle window before the runner exits (default: 5min in engine). */
  idleExitMs?: number;
  /** Hard cap on session lifetime (default: 30min in engine, max 360min via GHA). */
  hardCapMs?: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

export function sessionFilePath(sessionId: string): string {
  return `${SESSION_DIR}/${sessionId}.jsonl`;
}

export function buildMetaLine(
  opts: { idleExitMs?: number; hardCapMs?: number } = {},
): SessionMeta {
  return {
    type: "meta",
    mode: "interactive",
    createdAt: new Date().toISOString(),
    ...(opts.idleExitMs !== undefined ? { idleExitMs: opts.idleExitMs } : {}),
    ...(opts.hardCapMs !== undefined ? { hardCapMs: opts.hardCapMs } : {}),
  };
}

/**
 * Writes the meta line as the (initial) content of the session file. Use at
 * the start of an interactive session.
 *
 * `initialTurn` (optional): when provided, the first user turn is written in
 * the SAME commit as the meta line, so the runner sees it on its first read.
 * This is load-bearing for the vibe auto-kickoff: previously the kickoff turn
 * was written by a SECOND request (`/interactive/append`) right after this
 * one, and the two writes raced on the branch HEAD — the append's turn was
 * frequently lost, leaving a meta-only session. The runner then booted, found
 * no turn, and idle-exited with turnsCompleted:0 (the "handoff ran but nothing
 * happened / chat sits silent" bug). Folding the first turn into the meta
 * write removes that race entirely.
 *
 * Concurrency: each start commits a (distinct) session file to the same
 * branch, so two starts firing at once race on the branch HEAD — the loser
 * gets a 409 ("<path> is at <sha> but expected <sha>"). Without a retry that
 * surfaces as a 500 to the user (observed when two Vibe runs start together).
 * We retry on 409 with a small jittered backoff so concurrent starters
 * desynchronise and both land — same pattern appendUserTurn uses.
 */
export async function writeSessionMeta(
  octokit: Octokit,
  owner: string,
  repo: string,
  sessionId: string,
  meta: SessionMeta,
  branch: string = DEFAULT_BRANCH,
  maxRetries = 4,
  initialTurn?: ChatTurn,
): Promise<void> {
  const path = sessionFilePath(sessionId);
  const content = initialTurn
    ? `${JSON.stringify(meta)}\n${JSON.stringify({
        role: initialTurn.role,
        content: initialTurn.content,
        timestamp: initialTurn.timestamp,
        toolCalls: initialTurn.toolCalls ?? [],
      })}\n`
    : `${JSON.stringify(meta)}\n`;

  let attempt = 0;
  while (true) {
    attempt += 1;
    // Re-read the sha each attempt: a concurrent start may have created this
    // exact file (re-run of the same sessionId), and the branch HEAD may have
    // moved, so a stale sha would just collide again.
    const sha = await getFileSha(octokit, owner, repo, path, branch);
    try {
      await writeStateText({
        octokit,
        owner,
        repo,
        path,
        message: `chat: start interactive session ${sessionId}`,
        content,
        ...(sha ? { sha } : {}),
        maxAttempts: 1,
      });
      return;
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e.status === 409 && attempt < maxRetries) {
        await sleep(100 * attempt + Math.floor(Math.random() * 100));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Reads the existing session file, appends a single user turn, writes back.
 * Returns the new turn count so the caller can update local UI watermarks.
 *
 * Race window: if the runner pushes between our read and write, the sha
 * check fails and we retry once. Beyond that, surface the error — the
 * caller can decide to fall back to a fresh dispatch.
 */
export async function appendUserTurn(
  octokit: Octokit,
  owner: string,
  repo: string,
  sessionId: string,
  turn: ChatTurn,
  branch: string = DEFAULT_BRANCH,
  maxRetries = 3,
): Promise<{ turnCount: number }> {
  const path = sessionFilePath(sessionId);

  let attempt = 0;
  while (true) {
    attempt += 1;
    const existing = await readSessionFile(octokit, owner, repo, path, branch);
    const newContent =
      existing.content +
      `${JSON.stringify({
        role: turn.role,
        content: turn.content,
        timestamp: turn.timestamp,
        toolCalls: turn.toolCalls ?? [],
      })}\n`;

    try {
      await writeStateText({
        octokit,
        owner,
        repo,
        path,
        message: `chat: append turn for ${sessionId}`,
        content: newContent,
        sha: existing.sha,
        maxAttempts: 1,
      });
      return { turnCount: countTurnLines(newContent) };
    } catch (err: unknown) {
      const e = err as { status?: number };
      // 409 = sha mismatch (concurrent runner push). Retry with fresh sha.
      if (e.status === 409 && attempt < maxRetries) {
        await sleep(100 * attempt + Math.floor(Math.random() * 100));
        continue;
      }
      throw err;
    }
  }
}

// ─── internals ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFileSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  _branch: string,
): Promise<string | null> {
  try {
    return (await readStateText(octokit, owner, repo, path))?.sha ?? null;
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) return null;
    throw err;
  }
}

async function readSessionFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  _branch: string,
): Promise<{ content: string; sha: string | undefined }> {
  try {
    const file = await readStateText(octokit, owner, repo, path);
    if (!file) return { content: "", sha: undefined };
    return { content: file.content, sha: file.sha };
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) return { content: "", sha: undefined };
    throw err;
  }
}

function countTurnLines(content: string): number {
  return content.split("\n").filter((line) => {
    if (!line.trim()) return false;
    try {
      const parsed = JSON.parse(line) as { role?: string };
      return parsed.role === "user" || parsed.role === "assistant";
    } catch {
      return false;
    }
  }).length;
}
