/**
 * @fileType utility
 * @domain kody
 * @pattern github-budget
 * @ai-summary Proactive GitHub rate-limit circuit breaker. Octokit's throttling
 *   plugin reacts AFTER hitting the wall; this module senses the wall coming
 *   (`x-ratelimit-remaining`) and short-circuits before we burn the rest of
 *   the budget. Keeps the dashboard up (serving stale) instead of dark.
 *
 *   Why this matters: the polling token is shared across all dashboard users
 *   (5000 REST req/hr). When the budget is drained the entire dashboard goes
 *   dark for up to an hour. A regression that triples poll volume can blow
 *   the budget in minutes. This is the safety net.
 *
 *   Levels: read-block at <10% remaining (polling fetches return stale),
 *   write-block at <2% (PATCH/POST throw 503-with-Retry-After). Reads block
 *   first because they vastly outnumber writes and most read sites already
 *   have a stale fallback (ETag-tagged cache entries).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

interface BudgetSnapshot {
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms
  lastUpdated: number;
}

// Single shared record. We almost always poll through one token (the bot PAT)
// at a time; per-user write tokens have generous budgets and rarely block.
// If we ever multiplex tokens we can key this by `auth` instead.
let snapshot: BudgetSnapshot | null = null;

const READ_BLOCK_PCT = 0.1; // block reads when remaining < 10% of limit
const WRITE_BLOCK_PCT = 0.02; // block writes when remaining < 2% of limit

export class GitHubBudgetExhausted extends Error {
  readonly kind: "read" | "write";
  readonly retryAfterSeconds: number;
  readonly snapshot: BudgetSnapshot;
  constructor(
    kind: "read" | "write",
    snap: BudgetSnapshot,
    retryAfterSeconds: number,
  ) {
    super(
      `GitHub ${kind} budget exhausted (${snap.remaining}/${snap.limit}). Retry after ${retryAfterSeconds}s.`,
    );
    this.name = "GitHubBudgetExhausted";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.snapshot = snap;
  }
}

/**
 * Fed by Octokit's `hook.after("request", ...)` on every response.
 * Headers are case-insensitive; Octokit normalizes them lowercase.
 */
export function recordResponseHeaders(headers: Record<string, unknown>): void {
  const remainingRaw = headers["x-ratelimit-remaining"];
  const limitRaw = headers["x-ratelimit-limit"];
  const resetRaw = headers["x-ratelimit-reset"];
  const remaining =
    typeof remainingRaw === "string" ? Number(remainingRaw) : NaN;
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : NaN;
  const resetSeconds = typeof resetRaw === "string" ? Number(resetRaw) : NaN;
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return;
  snapshot = {
    remaining,
    limit: limit > 0 ? limit : 5000,
    resetAt: Number.isFinite(resetSeconds)
      ? resetSeconds * 1000
      : Date.now() + 60_000,
    lastUpdated: Date.now(),
  };
}

/**
 * Throw GitHubBudgetExhausted if remaining budget is below the threshold for
 * this request kind. Called from Octokit's `hook.before("request", ...)`
 * so it covers every REST call site without per-caller plumbing.
 *
 * Pre-flight unknowns are allowed through — we only act on real telemetry.
 */
export function assertBudget(kind: "read" | "write"): void {
  if (!snapshot) return;
  const pct = snapshot.remaining / Math.max(1, snapshot.limit);
  const threshold = kind === "write" ? WRITE_BLOCK_PCT : READ_BLOCK_PCT;
  if (pct > threshold) return;
  const retryAfter = Math.max(
    1,
    Math.ceil((snapshot.resetAt - Date.now()) / 1000),
  );
  throw new GitHubBudgetExhausted(kind, snapshot, retryAfter);
}

/** Read-only view, for diagnostics / status endpoints. */
export function getBudget(): BudgetSnapshot | null {
  return snapshot;
}

/** Classify HTTP method for budget thresholds. */
export function methodKind(method: string | undefined): "read" | "write" {
  if (!method) return "read";
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" ? "read" : "write";
}
