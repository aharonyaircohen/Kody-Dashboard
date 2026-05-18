/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-gist-store
 * @ai-summary Server-only CRUD over the user's per-repo inbox gist.
 *
 *   Each connected repo gets its own private gist owned by the logged-in
 *   user; discoverability is via `description = kody-inbox:<owner>/<repo>`.
 *   The dashboard server holds **no** persistent state for the inbox — every
 *   operation walks the user's gist list with their PAT.
 *
 *   Concurrency: gists have no ETag/CAS like issues, so we serialize writes
 *   per (login, repo) using an in-process mutex. Two Vercel instances racing
 *   is rare in practice (the inbox is one-tab-per-user) and would just lose
 *   the older entry on a concurrent append — acceptable.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import {
  EMPTY_INBOX_MANIFEST,
  INBOX_GIST_DESCRIPTION_PREFIX,
  INBOX_GIST_FILE,
  INBOX_MAX_ENTRIES,
  inboxGistDescription,
  parseInboxManifest,
  serializeInboxManifest,
  type InboxEntry,
  type InboxManifest,
} from "./types";
import { ctoFeedKey } from "./feed";

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(
    () => fn(),
    () => fn(),
  );
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

interface GistRef {
  id: string | null;
  manifest: InboxManifest;
}

async function getAuthenticatedLogin(octokit: Octokit): Promise<string | null> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return typeof data?.login === "string" ? data.login : null;
  } catch {
    return null;
  }
}

async function findInboxGist(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string | null> {
  const wanted = inboxGistDescription(owner, repo);
  // Walk up to 5 pages (500 gists) — enough for any reasonable user.
  for (let page = 1; page <= 5; page++) {
    const { data } = await octokit.rest.gists.list({ per_page: 100, page });
    const hit = data.find((g) => g.description === wanted);
    if (hit?.id) return hit.id;
    if (data.length < 100) return null;
  }
  return null;
}

async function readGistManifest(
  octokit: Octokit,
  gistId: string,
): Promise<InboxManifest> {
  const { data } = await octokit.rest.gists.get({ gist_id: gistId });
  const file = data.files?.[INBOX_GIST_FILE];
  // GitHub truncates files >1MB in the gist get response — fetch raw_url.
  if (file?.truncated && file.raw_url) {
    try {
      const res = await fetch(file.raw_url);
      if (res.ok) return parseInboxManifest(await res.text());
    } catch {
      // fall through
    }
  }
  return parseInboxManifest(file?.content ?? null);
}

async function readInboxGist(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<GistRef> {
  const id = await findInboxGist(octokit, owner, repo);
  if (!id)
    return { id: null, manifest: { ...EMPTY_INBOX_MANIFEST, entries: [] } };
  const manifest = await readGistManifest(octokit, id);
  return { id, manifest };
}

async function writeInboxGist(
  octokit: Octokit,
  owner: string,
  repo: string,
  existingId: string | null,
  manifest: InboxManifest,
): Promise<string> {
  const body = serializeInboxManifest(manifest);
  if (existingId) {
    await octokit.rest.gists.update({
      gist_id: existingId,
      files: { [INBOX_GIST_FILE]: { content: body } },
    });
    return existingId;
  }
  const { data } = await octokit.rest.gists.create({
    description: inboxGistDescription(owner, repo),
    public: false,
    files: { [INBOX_GIST_FILE]: { content: body } },
  });
  if (!data.id) throw new Error("gist create returned no id");
  return data.id;
}

function lockKey(login: string | null, owner: string, repo: string): string {
  return `inbox:${login ?? "?"}:${owner}/${repo}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface InboxReadResult {
  gistId: string | null;
  manifest: InboxManifest;
}

export async function readInbox(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<InboxReadResult> {
  const { id, manifest } = await readInboxGist(octokit, owner, repo);
  return { gistId: id, manifest };
}

/**
 * Mutate the inbox manifest under a per-user mutex. Returns the new manifest
 * (or the unchanged manifest if `mutator` returns `null`, signalling no-op).
 */
export async function mutateInbox(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutator: (m: InboxManifest) => InboxManifest | null,
): Promise<InboxManifest> {
  const login = await getAuthenticatedLogin(octokit);
  return withLock(lockKey(login, owner, repo), async () => {
    const { id, manifest } = await readInboxGist(octokit, owner, repo);
    const next = mutator(manifest);
    if (!next) return manifest;
    await writeInboxGist(octokit, owner, repo, id, next);
    return next;
  });
}

/**
 * Append new entries, deduping by `id` and capping at INBOX_MAX_ENTRIES.
 * Newer entries (later sentAt) sort first; ties keep insertion order.
 * Returns the count of entries actually added (after de-dupe).
 */
export async function appendInboxEntries(
  octokit: Octokit,
  owner: string,
  repo: string,
  incoming: InboxEntry[],
): Promise<{ manifest: InboxManifest; added: number }> {
  if (incoming.length === 0) {
    const { manifest } = await readInbox(octokit, owner, repo);
    return { manifest, added: 0 };
  }
  let added = 0;
  const manifest = await mutateInbox(octokit, owner, repo, (current) => {
    const seen = new Set(current.entries.map((e) => e.id));
    const fresh = incoming.filter((e) => !seen.has(e.id));
    added = fresh.length;
    const all = [...fresh, ...current.entries];
    all.sort(
      (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
    );
    // Collapse CTO recommendation duplicates across the *whole* manifest
    // (newest per task+action wins — list is already sorted newest-first),
    // so a backlog of repeated recs the CTO posted before the feed-side
    // fix self-heals. Non-rec entries pass through untouched.
    const seenCtoKey = new Set<string>();
    const collapsed = all.filter((e) => {
      const k = ctoFeedKey(e);
      if (k === null) return true;
      if (seenCtoKey.has(k)) return false;
      seenCtoKey.add(k);
      return true;
    });
    // No new entries AND nothing collapsed → genuine no-op, skip the write
    // so plain polling never costs a gist commit.
    if (fresh.length === 0 && collapsed.length === current.entries.length) {
      return null;
    }
    return { version: 1, entries: collapsed.slice(0, INBOX_MAX_ENTRIES) };
  });
  return { manifest, added };
}

export async function markEntryRead(
  octokit: Octokit,
  owner: string,
  repo: string,
  entryId: string,
  readAt: string | null,
): Promise<InboxManifest> {
  return mutateInbox(octokit, owner, repo, (current) => {
    let changed = false;
    const entries = current.entries.map((e) => {
      if (e.id !== entryId) return e;
      if ((e.readAt ?? null) === readAt) return e;
      changed = true;
      return { ...e, readAt };
    });
    if (!changed) return null;
    return { version: 1, entries };
  });
}

export async function markAllRead(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<InboxManifest> {
  const now = new Date().toISOString();
  return mutateInbox(octokit, owner, repo, (current) => {
    if (current.entries.every((e) => e.readAt)) return null;
    return {
      version: 1,
      entries: current.entries.map((e) =>
        e.readAt ? e : { ...e, readAt: now },
      ),
    };
  });
}

export async function markByUrl(
  octokit: Octokit,
  owner: string,
  repo: string,
  url: string,
): Promise<InboxManifest> {
  const now = new Date().toISOString();
  return mutateInbox(octokit, owner, repo, (current) => {
    let changed = false;
    const entries = current.entries.map((e) => {
      if (e.url !== url || e.readAt) return e;
      changed = true;
      return { ...e, readAt: now };
    });
    if (!changed) return null;
    return { version: 1, entries };
  });
}

export async function deleteEntry(
  octokit: Octokit,
  owner: string,
  repo: string,
  entryId: string,
): Promise<InboxManifest> {
  return mutateInbox(octokit, owner, repo, (current) => {
    const entries = current.entries.filter((e) => e.id !== entryId);
    if (entries.length === current.entries.length) return null;
    return { version: 1, entries };
  });
}

export { INBOX_GIST_DESCRIPTION_PREFIX };
