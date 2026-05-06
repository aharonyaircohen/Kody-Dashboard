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
 * session file via the Contents API without triggering anything new.
 *
 * Auth model is the same inline HMAC token as one-shot chat — see
 * chat-token.ts. The runner verifies the token on ingest POSTs so we
 * don't need a shared session-state DB.
 */

import type { Octokit } from "@octokit/rest";
import { Buffer } from "buffer";

const SESSION_DIR = ".kody/sessions";
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

export function buildMetaLine(opts: { idleExitMs?: number; hardCapMs?: number } = {}): SessionMeta {
  return {
    type: "meta",
    mode: "interactive",
    createdAt: new Date().toISOString(),
    ...(opts.idleExitMs !== undefined ? { idleExitMs: opts.idleExitMs } : {}),
    ...(opts.hardCapMs !== undefined ? { hardCapMs: opts.hardCapMs } : {}),
  };
}

/**
 * Writes the meta line as the only content of the session file. Use at the
 * start of an interactive session — the runner enters its poll loop with an
 * empty turn list and waits for the first user message via append().
 */
export async function writeSessionMeta(
  octokit: Octokit,
  owner: string,
  repo: string,
  sessionId: string,
  meta: SessionMeta,
  branch: string = DEFAULT_BRANCH,
): Promise<void> {
  const path = sessionFilePath(sessionId);
  const content = `${JSON.stringify(meta)}\n`;
  const sha = await getFileSha(octokit, owner, repo, path, branch);
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `chat: start interactive session ${sessionId}`,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
    branch,
  });
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
    const newContent = existing.content + `${JSON.stringify({
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp,
      toolCalls: turn.toolCalls ?? [],
    })}\n`;

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `chat: append turn for ${sessionId}`,
        content: Buffer.from(newContent).toString("base64"),
        sha: existing.sha,
        branch,
      });
      return { turnCount: countTurnLines(newContent) };
    } catch (err: unknown) {
      const e = err as { status?: number };
      // 409 = sha mismatch (concurrent runner push). Retry with fresh sha.
      if (e.status === 409 && attempt < maxRetries) continue;
      throw err;
    }
  }
}

/**
 * Build the dashboard ingest URL with the sessionId as a query param.
 * Auth on the ingest endpoint is GitHub Actions IP verification — no
 * shared secret to mint. Engine appends `?sessionId=...` itself when
 * delivering, but we keep the param here so the URL is debuggable as-is.
 */
export function buildDashboardUrl(baseUrl: string, sessionId: string): string {
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}sessionId=${encodeURIComponent(sessionId)}`;
}

// ─── internals ─────────────────────────────────────────────────────────────

async function getFileSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if ("sha" in res.data && typeof res.data.sha === "string") return res.data.sha;
    return null;
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
  branch: string,
): Promise<{ content: string; sha: string | undefined }> {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(res.data)) throw new Error("session path is a directory, not a file");
    if (!("content" in res.data) || !("sha" in res.data)) {
      throw new Error("unexpected getContent response shape");
    }
    const decoded = Buffer.from(res.data.content, "base64").toString("utf-8");
    return { content: decoded, sha: res.data.sha };
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
