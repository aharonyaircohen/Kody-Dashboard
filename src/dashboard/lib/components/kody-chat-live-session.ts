/**
 * @fileType data
 * @domain kody
 * @pattern kody-chat-live-session
 * @ai-summary localStorage-backed persistence + auth header helpers for the
 *   chat client. Kody Live sessions survive refreshes (scoped per repo, with
 *   one-time migrations from legacy key shapes and stale-record pruning);
 *   Brain chat ids are pinned so server-side history doesn't "vanish" when a
 *   transient prefix flips. Pure module — no React.
 */

import {
  getStoredAuth,
  getStoredBrainConfig,
  getStoredBrainSuspension,
} from "../api";
import type { ChatContext } from "../chat-types";
import type { LiveScopeKey } from "./kody-chat-reducer";

export type { LiveScopeKey };

/** Build fetch headers including client auth when available */
export function authHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  return auth
    ? {
        "x-kody-token": auth.token,
        "x-kody-owner": auth.owner,
        "x-kody-repo": auth.repo,
        ...(auth.storeRepoUrl
          ? { "x-kody-store-repo-url": auth.storeRepoUrl }
          : {}),
        ...(auth.storeRef ? { "x-kody-store-ref": auth.storeRef } : {}),
        "x-kody-brain-suspension": getStoredBrainSuspension(),
      }
    : {};
}

// ─── Brain chat-id stickiness ────────────────────────────────────────────────
// Brain keeps all conversation memory server-side, keyed by the chatId we send
// each turn. If that id changes mid-conversation (e.g. `actorLogin` is briefly
// null so the prefix flips guy-- → anon--, or a global session id gets
// re-minted), Brain looks up an empty chat and the history "vanishes". So we
// pin the id: the first turn for a given logical conversation wins, and every
// later turn reuses it verbatim regardless of transient prefix/session churn.
const BRAIN_CHAT_ID_KEY = "kody-brain-chat-ids";

/**
 * Whether a Brain chatId has already been pinned for this logical key, i.e.
 * the conversation has had at least one turn. Used to send heavy ambient
 * context (dashboard Context block) only on the *first* turn — the Brain is
 * stateful, so once it's seen the context it keeps it for the chat's life.
 * Must be called *before* `stickyBrainChatId`, which pins on first use.
 */
export function isBrainChatPinned(logicalKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(BRAIN_CHAT_ID_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, string>;
    return typeof map[logicalKey] === "string";
  } catch {
    return false;
  }
}

export function stickyBrainChatId(
  logicalKey: string,
  candidate: string,
): string {
  if (typeof window === "undefined") return candidate;
  try {
    const raw = window.localStorage.getItem(BRAIN_CHAT_ID_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const pinned = map[logicalKey];
    if (pinned) return pinned;
    map[logicalKey] = candidate;
    window.localStorage.setItem(BRAIN_CHAT_ID_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable/corrupt — fall back to the candidate. Worst
    // case is the pre-fix behavior, not a crash.
  }
  return candidate;
}

// ─── Kody Live persistence ───────────────────────────────────────────────────
// Survives page refreshes by saving the live session to localStorage. Stale
// records (older than the engine's 30min hard cap + 5min idle buffer) are
// dropped on load.

// Live sessions persist as a Map keyed by scope so each task (e.g. each
// open Vibe issue) gets its own runner, its own GHA workflow run, and its
// own state. Old single-record storage is migrated on read so existing
// in-flight sessions don't get dropped on deploy.
const LIVE_SESSION_STORAGE_KEY_BASE = "kody-live-sessions";
const LIVE_SESSION_UNSCOPED_KEY = "kody-live-sessions";
const LIVE_SESSION_LEGACY_KEY = "kody-live-session";
const LIVE_SESSION_MAX_AGE_MS = 35 * 60_000;

/**
 * Per-repo storage key for live sessions. Same rule as the chat session and
 * task-chat caches: scope by `<owner>/<repo>` (lowercase) from
 * localStorage.kody_auth so a Vibe runner in repo A doesn't leak into repo B
 * (issue numbers collide otherwise — `vibe-5` in both repos hits the same
 * record). Falls back to the unscoped key when no repo is connected, which
 * also doubles as the read target for the one-time legacy migration below.
 */
function liveSessionStorageKey(): string {
  if (typeof window === "undefined") return LIVE_SESSION_UNSCOPED_KEY;
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return LIVE_SESSION_UNSCOPED_KEY;
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return LIVE_SESSION_UNSCOPED_KEY;
    return `${LIVE_SESSION_STORAGE_KEY_BASE}:${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}`;
  } catch {
    return LIVE_SESSION_UNSCOPED_KEY;
  }
}

export function getLiveScopeKey(
  context: ChatContext | null | undefined,
  vibeMode: boolean | undefined,
): LiveScopeKey {
  if (vibeMode && context?.kind === "task") {
    return `vibe-${context.task.issueNumber}`;
  }
  // Vibe page with no task selected — keep its live-runner state
  // separate from the dashboard's global chat so the two don't share
  // an in-flight Kody Live session.
  if (vibeMode) {
    return "vibe-default";
  }
  return "global";
}

export interface PersistedLiveSession {
  sessionId: string;
  state: "booting" | "ready";
  startedAt: number;
  // Captured at /start time. Lets the booting banner render the
  // "Watching <owner>/<repo>" link after a refresh without waiting for
  // chat.ready to re-fire on the new SSE connection.
  target?: { owner: string; repo: string };
  // Captured when chat.ready arrives (engine ≥ 0.3.79). Survives refresh
  // so the deep link doesn't downgrade to the workflow-list page.
  runUrl?: string;
}

type LiveSessionMap = Record<LiveScopeKey, PersistedLiveSession>;

function readAllLiveSessions(): LiveSessionMap {
  if (typeof window === "undefined") return {};
  try {
    const storageKey = liveSessionStorageKey();
    const raw = window.localStorage.getItem(storageKey);
    let parsed: LiveSessionMap = raw ? (JSON.parse(raw) as LiveSessionMap) : {};
    // One-time migration from the legacy single-record format.
    const legacy = window.localStorage.getItem(LIVE_SESSION_LEGACY_KEY);
    if (legacy && Object.keys(parsed).length === 0) {
      try {
        const legacyRecord = JSON.parse(legacy) as PersistedLiveSession;
        if (
          legacyRecord?.sessionId &&
          typeof legacyRecord.startedAt === "number"
        ) {
          parsed = { global: legacyRecord };
          window.localStorage.setItem(storageKey, JSON.stringify(parsed));
        }
      } catch {
        /* ignore malformed legacy record */
      }
      window.localStorage.removeItem(LIVE_SESSION_LEGACY_KEY);
    }
    // One-time migration from the unscoped per-map key: adopt under the
    // current repo, then drop the unscoped entry. Only runs when storageKey
    // is genuinely scoped — otherwise the read above already targeted the
    // unscoped key.
    if (
      storageKey !== LIVE_SESSION_UNSCOPED_KEY &&
      Object.keys(parsed).length === 0
    ) {
      const unscopedRaw = window.localStorage.getItem(
        LIVE_SESSION_UNSCOPED_KEY,
      );
      if (unscopedRaw) {
        try {
          const unscoped = JSON.parse(unscopedRaw) as LiveSessionMap;
          if (unscoped && typeof unscoped === "object") {
            parsed = unscoped;
            window.localStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        } catch {
          /* malformed — drop it below */
        }
        window.localStorage.removeItem(LIVE_SESSION_UNSCOPED_KEY);
      }
    }
    // Drop stale entries so callers never see expired records.
    const now = Date.now();
    let changed = false;
    for (const [key, rec] of Object.entries(parsed)) {
      if (!rec?.sessionId || typeof rec.startedAt !== "number") {
        delete parsed[key];
        changed = true;
        continue;
      }
      if (now - rec.startedAt > LIVE_SESSION_MAX_AGE_MS) {
        delete parsed[key];
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(storageKey, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return {};
  }
}

export function loadLiveSession(
  scopeKey: LiveScopeKey,
): PersistedLiveSession | null {
  const all = readAllLiveSessions();
  return all[scopeKey] ?? null;
}

export function saveLiveSession(
  scopeKey: LiveScopeKey,
  record: PersistedLiveSession,
): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAllLiveSessions();
    all[scopeKey] = record;
    window.localStorage.setItem(liveSessionStorageKey(), JSON.stringify(all));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export function clearLiveSession(scopeKey: LiveScopeKey): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAllLiveSessions();
    if (!(scopeKey in all)) return;
    delete all[scopeKey];
    window.localStorage.setItem(liveSessionStorageKey(), JSON.stringify(all));
  } catch {
    /* non-fatal */
  }
}

/**
 * Look up the engine repo a live session was dispatched to. The user may
 * switch their connected repo after Kody Live boots — but events still
 * live in the dispatch repo, so SSE/poll/append must keep targeting it
 * for the lifetime of the runner. Falls back to null when the session
 * isn't a known live one (regular per-task chat).
 */
function findLiveSessionTarget(
  sessionId: string,
): { owner: string; repo: string } | null {
  if (!sessionId || typeof window === "undefined") return null;
  const all = readAllLiveSessions();
  for (const rec of Object.values(all)) {
    if (rec.sessionId === sessionId && rec.target) return rec.target;
  }
  return null;
}

/**
 * Like getStoredAuth(), but for live-session-bound calls: keeps the user's
 * PAT, overrides owner/repo with the session's pinned target when present.
 * Use this for /events/poll, /events/stream, and /interactive/append —
 * never for the initial /interactive/start (that defines the target).
 */
export function liveAuthFor(sessionId: string): {
  token: string;
  owner: string;
  repo: string;
  storeRepoUrl?: string;
  storeRef?: string;
} | null {
  const auth = getStoredAuth();
  if (!auth) return null;
  const target = findLiveSessionTarget(sessionId);
  if (target)
    return {
      token: auth.token,
      owner: target.owner,
      repo: target.repo,
      storeRepoUrl: auth.storeRepoUrl,
      storeRef: auth.storeRef,
    };
  return auth;
}

export function liveAuthHeaders(sessionId: string): Record<string, string> {
  const a = liveAuthFor(sessionId);
  return a
    ? {
        "x-kody-token": a.token,
        "x-kody-owner": a.owner,
        "x-kody-repo": a.repo,
        ...(a.storeRepoUrl ? { "x-kody-store-repo-url": a.storeRepoUrl } : {}),
        ...(a.storeRef ? { "x-kody-store-ref": a.storeRef } : {}),
      }
    : {};
}

/** Add per-user Brain config headers on Brain-path requests. */
export function brainHeaders(): Record<string, string> {
  const b = getStoredBrainConfig();
  return b ? { "x-brain-url": b.url, "x-brain-key": b.apiKey } : {};
}
