/**
 * @fileType utility
 * @domain kody
 * @pattern channels-seen-manifest
 * @ai-summary Types + parse/serialize for the per-user "channel read-state"
 *   gist. Mirrors the inbox gist pattern: one private gist per (login, repo),
 *   discovered by `description = kody-channels:<owner>/<repo>`, holding a single
 *   `channels-seen.json`. It records, per channel number, the ISO time the user
 *   last opened that channel — the Messages nav badge lights up when a channel's
 *   latest activity (`MessageChannel.updatedAt`) is newer than that.
 *
 *   `baseline` is stamped when the store is first created. A channel whose
 *   latest activity predates the baseline (and which the user never explicitly
 *   opened) counts as already-seen, so the badge never lights up for the whole
 *   pre-existing history the first time someone loads Messages.
 */
export const CHANNELS_SEEN_GIST_DESCRIPTION_PREFIX = "kody-channels:";
export const CHANNELS_SEEN_GIST_FILE = "channels-seen.json";

export interface ChannelsSeenManifest {
  version: 1;
  /** ISO time the store was created — the "nothing before this is unread" mark. */
  baseline: string;
  /** channelNumber (string key) → ISO time the user last opened that channel. */
  seen: Record<string, string>;
}

export function channelsSeenGistDescription(
  owner: string,
  repo: string,
): string {
  return `${CHANNELS_SEEN_GIST_DESCRIPTION_PREFIX}${owner}/${repo}`;
}

/** A fresh manifest whose baseline is "now" — used on first create. */
export function emptyChannelsSeenManifest(): ChannelsSeenManifest {
  return { version: 1, baseline: new Date().toISOString(), seen: {} };
}

/** Parse the gist file. Returns null for missing/blank/corrupt content so the
 *  caller can decide whether to fall back to a fresh manifest. */
export function parseChannelsSeenManifest(
  raw: string | null | undefined,
): ChannelsSeenManifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChannelsSeenManifest>;
    if (!parsed || typeof parsed !== "object") return null;
    const baseline =
      typeof parsed.baseline === "string"
        ? parsed.baseline
        : new Date(0).toISOString();
    const seen: Record<string, string> = {};
    if (parsed.seen && typeof parsed.seen === "object") {
      for (const [k, v] of Object.entries(parsed.seen)) {
        if (typeof v === "string") seen[k] = v;
      }
    }
    return { version: 1, baseline, seen };
  } catch {
    return null;
  }
}

export function serializeChannelsSeenManifest(m: ChannelsSeenManifest): string {
  return JSON.stringify(m, null, 2);
}
