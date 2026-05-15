/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-cas
 * @ai-summary Server-only notifications-manifest helpers. Mirrors
 *   `goals-server.ts`: per-repo mutex + verify-after-write retry around the
 *   read-mutate-write cycle so concurrent rule edits can't silently
 *   overwrite each other. Could be generalized into a shared "manifest
 *   issue helper" later — kept duplicated for v1 to limit blast radius.
 */
import type { Octokit } from "@octokit/rest";
import {
  fetchIssues,
  fetchIssue,
  createIssue,
  updateIssue,
  invalidateIssueCache,
  getOwner,
  getRepo,
} from "./github-client";
import {
  EMPTY_MANIFEST,
  NOTIFICATIONS_MANIFEST_LABEL,
  MANIFEST_ISSUE_TITLE,
  parseManifestBody,
  serializeManifestBody,
  type NotificationsManifest,
  type NotificationRule,
} from "./notifications";

const locks = new Map<string, Promise<unknown>>();

async function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(
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

interface ManifestRef {
  number: number | null;
  manifest: NotificationsManifest;
}

async function readManifestFresh(): Promise<ManifestRef> {
  const issues = await fetchIssues({
    state: "open",
    labels: NOTIFICATIONS_MANIFEST_LABEL,
    perPage: 5,
    noCache: true,
  });
  if (!issues.length) {
    return { number: null, manifest: { ...EMPTY_MANIFEST, rules: [] } };
  }
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number, { noCache: true });
  return {
    number: first.number,
    manifest: parseManifestBody(full?.body ?? ""),
  };
}

async function writeManifest(
  next: NotificationsManifest,
  existingNumber: number | null,
  userOctokit?: Octokit,
): Promise<number> {
  const body = serializeManifestBody(next);
  if (existingNumber !== null) {
    await updateIssue(existingNumber, { body }, userOctokit);
    return existingNumber;
  }
  const created = await createIssue(
    {
      title: MANIFEST_ISSUE_TITLE,
      body,
      labels: [NOTIFICATIONS_MANIFEST_LABEL],
    },
    userOctokit,
  );
  return created.number;
}

function rulesEqual(a: NotificationRule, b: NotificationRule): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.enabled !== b.enabled ||
    a.event !== b.event ||
    a.channel.type !== b.channel.type ||
    (a.template ?? null) !== (b.template ?? null) ||
    a.createdAt !== b.createdAt ||
    (a.updatedAt ?? null) !== (b.updatedAt ?? null)
  ) {
    return false;
  }
  // Channel comparison — JSON-stringify is enough since fields are scalar
  // and the union shapes don't overlap. Cheap and matches the manifest's
  // serialized form bytewise.
  return JSON.stringify(a.channel) === JSON.stringify(b.channel);
}

function manifestsEqual(
  a: NotificationsManifest,
  b: NotificationsManifest,
): boolean {
  if (a.rules.length !== b.rules.length) return false;
  for (let i = 0; i < a.rules.length; i++) {
    if (!rulesEqual(a.rules[i], b.rules[i])) return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MutateOptions {
  userOctokit?: Octokit;
  maxAttempts?: number;
}

export interface MutationOutcome<T> {
  result: T;
  manifest: NotificationsManifest;
  issueNumber: number;
}

export type MutatorReturn<T> =
  | { next: NotificationsManifest; result: T }
  | { kind: "noop"; result: T };

export type Mutator<T> = (
  current: NotificationsManifest,
) => MutatorReturn<T> | Promise<MutatorReturn<T>>;

export async function mutateNotificationsManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  const lockKey = `${getOwner()}/${getRepo()}`;
  const maxAttempts = options.maxAttempts ?? 3;

  return withRepoLock(lockKey, async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await readManifestFresh();
      const mutation = await mutator(ref.manifest);
      if ("kind" in mutation && mutation.kind === "noop") {
        return { kind: "noop" as const, result: mutation.result };
      }
      const written = mutation as { next: NotificationsManifest; result: T };
      const issueNumber = await writeManifest(
        written.next,
        ref.number,
        options.userOctokit,
      );
      invalidateIssueCache(issueNumber);

      const verify = await fetchIssue(issueNumber, { noCache: true });
      const verifyManifest = parseManifestBody(verify?.body ?? "");
      if (manifestsEqual(verifyManifest, written.next)) {
        return {
          result: written.result,
          manifest: written.next,
          issueNumber,
        };
      }
      lastError = new Error(
        `notifications manifest write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(50 * attempt + Math.floor(Math.random() * 50));
    }
    throw (
      lastError ??
      new Error(
        `notifications manifest write conflict: failed after ${maxAttempts} attempts`,
      )
    );
  });
}

/**
 * Read-only fresh accessor for the webhook handler / dispatcher (cache
 * bypass — the dispatcher should always see the latest rule state when
 * deciding whether to fire).
 */
export async function readNotificationsManifestFresh(): Promise<ManifestRef> {
  return readManifestFresh();
}
