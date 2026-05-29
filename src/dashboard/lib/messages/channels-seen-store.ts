/**
 * @fileType utility
 * @domain kody
 * @pattern channels-seen-gist-store
 * @ai-summary Server-only CRUD over the user's per-repo "channel read-state"
 *   gist (see channels-seen.ts). Same shape as the inbox gist store: discover
 *   the private gist by description, read/write its single JSON file, serialize
 *   writes per (login, repo) with an in-process mutex. The dashboard keeps no
 *   persistent state — every call walks the user's gist list with their PAT.
 *
 *   `readChannelsSeen` lazily creates the gist (stamping `baseline = now`) when
 *   it doesn't exist yet, so the very first Messages load gets a stable, synced
 *   baseline and the badge only ever reflects activity after the user started
 *   using the feature.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import {
  channelsSeenGistDescription,
  emptyChannelsSeenManifest,
  parseChannelsSeenManifest,
  serializeChannelsSeenManifest,
  CHANNELS_SEEN_GIST_FILE,
  type ChannelsSeenManifest,
} from "./channels-seen";

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

async function getAuthenticatedLogin(octokit: Octokit): Promise<string | null> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return typeof data?.login === "string" ? data.login : null;
  } catch {
    return null;
  }
}

async function findGist(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string | null> {
  const wanted = channelsSeenGistDescription(owner, repo);
  for (let page = 1; page <= 5; page++) {
    const { data } = await octokit.rest.gists.list({ per_page: 100, page });
    const hit = data.find((g) => g.description === wanted);
    if (hit?.id) return hit.id;
    if (data.length < 100) return null;
  }
  return null;
}

async function readGistFile(
  octokit: Octokit,
  gistId: string,
): Promise<string | null> {
  const { data } = await octokit.rest.gists.get({ gist_id: gistId });
  const file = data.files?.[CHANNELS_SEEN_GIST_FILE];
  return file?.content ?? null;
}

async function writeGist(
  octokit: Octokit,
  owner: string,
  repo: string,
  existingId: string | null,
  manifest: ChannelsSeenManifest,
): Promise<string> {
  const body = serializeChannelsSeenManifest(manifest);
  if (existingId) {
    await octokit.rest.gists.update({
      gist_id: existingId,
      files: { [CHANNELS_SEEN_GIST_FILE]: { content: body } },
    });
    return existingId;
  }
  const { data } = await octokit.rest.gists.create({
    description: channelsSeenGistDescription(owner, repo),
    public: false,
    files: { [CHANNELS_SEEN_GIST_FILE]: { content: body } },
  });
  if (!data.id) throw new Error("gist create returned no id");
  return data.id;
}

async function readRef(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ id: string | null; manifest: ChannelsSeenManifest }> {
  const id = await findGist(octokit, owner, repo);
  if (!id) return { id: null, manifest: emptyChannelsSeenManifest() };
  const raw = await readGistFile(octokit, id);
  return {
    id,
    manifest: parseChannelsSeenManifest(raw) ?? emptyChannelsSeenManifest(),
  };
}

function lockKey(login: string | null, owner: string, repo: string): string {
  return `channels-seen:${login ?? "?"}:${owner}/${repo}`;
}

/**
 * Read the read-state manifest, lazily creating the gist (with `baseline = now`)
 * when none exists so the badge has a stable, synced baseline from first load.
 */
export async function readChannelsSeen(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ChannelsSeenManifest> {
  const login = await getAuthenticatedLogin(octokit);
  return withLock(lockKey(login, owner, repo), async () => {
    const { id, manifest } = await readRef(octokit, owner, repo);
    if (!id) await writeGist(octokit, owner, repo, null, manifest);
    return manifest;
  });
}

/**
 * Stamp a channel as seen at `at` (ISO). Creates the gist on first write.
 * Returns the updated manifest.
 */
export async function markChannelSeen(
  octokit: Octokit,
  owner: string,
  repo: string,
  channelNumber: number,
  at: string,
): Promise<ChannelsSeenManifest> {
  const login = await getAuthenticatedLogin(octokit);
  return withLock(lockKey(login, owner, repo), async () => {
    const { id, manifest } = await readRef(octokit, owner, repo);
    const next: ChannelsSeenManifest = {
      ...manifest,
      seen: { ...manifest.seen, [String(channelNumber)]: at },
    };
    await writeGist(octokit, owner, repo, id, next);
    return next;
  });
}
