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
} from "../../api";
import type { ChatContext } from "../../chat-types";
import type { LiveScopeKey } from "./kody-chat-reducer";
import { readActiveRepoScope } from "../../active-repo";
import {
  brainChatIdMapSchema,
  liveSessionMapSchema,
  persistedLiveSessionSchema,
} from "./live-session-schemas";

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
const MAX_BRAIN_CHAT_ID_LENGTH = 200;

function safeBrainChatId(id: string): string {
  const cleaned = id
    .replace(/\\/g, "-")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => {
      const trimmed = segment.replace(/^\.+|\.+$/g, "");
      return trimmed || "chat";
    })
    .join("/");
  return (cleaned || "chat").slice(0, MAX_BRAIN_CHAT_ID_LENGTH);
}

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
    // Corrupt payload (bad JSON / not an object) → not pinned.
    const parsed = brainChatIdMapSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return false;
    return typeof parsed.data[logicalKey] === "string";
  } catch {
    return false;
  }
}

export function stickyBrainChatId(
  logicalKey: string,
  candidate: string,
): string {
  const safeCandidate = safeBrainChatId(candidate);
  if (typeof window === "undefined") return safeCandidate;
  try {
    const raw = window.localStorage.getItem(BRAIN_CHAT_ID_KEY);
    // Corrupt payload (bad JSON / not an object) → start from an empty map,
    // pinning the candidate — same "treat as absent" fallback as before.
    const parsed = raw ? brainChatIdMapSchema.safeParse(JSON.parse(raw)) : null;
    const map: Record<string, unknown> = parsed?.success ? parsed.data : {};
    const pinned = map[logicalKey];
    if (pinned) {
      // A corrupt non-string pin can't be repaired or reused — fall back to
      // the candidate without touching storage (pre-zod behavior).
      if (typeof pinned !== "string") return safeCandidate;
      const safePinned = safeBrainChatId(pinned);
      if (safePinned !== pinned) {
        window.localStorage.setItem(
          BRAIN_CHAT_ID_KEY,
          JSON.stringify({ ...map, [logicalKey]: safePinned }),
        );
      }
      return safePinned;
    }
    window.localStorage.setItem(
      BRAIN_CHAT_ID_KEY,
      JSON.stringify({ ...map, [logicalKey]: safeCandidate }),
    );
  } catch {
    // localStorage unavailable/corrupt — fall back to the candidate. Worst
    // case is the pre-fix behavior, not a crash.
  }
  return safeCandidate;
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
  const scope = readActiveRepoScope();
  if (!scope) return LIVE_SESSION_UNSCOPED_KEY;
  return `${LIVE_SESSION_STORAGE_KEY_BASE}:${scope}`;
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
    // Outer shape first (corrupt map → treated as empty); entries stay
    // unknown so one bad record can't discard its healthy siblings — the
    // per-entry prune below validates each one.
    const rawParsed = raw ? liveSessionMapSchema.safeParse(JSON.parse(raw)) : null;
    let parsed: Record<string, unknown> = rawParsed?.success
      ? rawParsed.data
      : {};
    // One-time migration from the legacy single-record format.
    const legacy = window.localStorage.getItem(LIVE_SESSION_LEGACY_KEY);
    if (legacy && Object.keys(parsed).length === 0) {
      try {
        const legacyRecord = persistedLiveSessionSchema.safeParse(
          JSON.parse(legacy),
        );
        if (legacyRecord.success) {
          parsed = { global: legacyRecord.data };
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
          const unscoped = liveSessionMapSchema.safeParse(
            JSON.parse(unscopedRaw),
          );
          if (unscoped.success) {
            parsed = unscoped.data;
            window.localStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        } catch {
          /* malformed — drop it below */
        }
        window.localStorage.removeItem(LIVE_SESSION_UNSCOPED_KEY);
      }
    }
    // Drop stale or malformed entries so callers never see expired or
    // invalid records (immutably — build the pruned map, don't mutate).
    const now = Date.now();
    let changed = false;
    const pruned: LiveSessionMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const rec = persistedLiveSessionSchema.safeParse(value);
      if (!rec.success || now - rec.data.startedAt > LIVE_SESSION_MAX_AGE_MS) {
        changed = true;
        continue;
      }
      pruned[key] = rec.data;
    }
    if (changed) {
      window.localStorage.setItem(storageKey, JSON.stringify(pruned));
    }
    return pruned;
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
