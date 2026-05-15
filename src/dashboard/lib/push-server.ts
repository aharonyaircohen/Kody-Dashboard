/**
 * @fileType utility
 * @domain kody
 * @pattern push-subscriptions-cas
 * @ai-summary Server-only helpers for the push-subscriptions manifest issue.
 *   Mirrors `notifications-server.ts` exactly — per-repo mutex + verify-after-
 *   write retry around the read-mutate-write cycle so concurrent subscribe/
 *   unsubscribe calls can't silently overwrite each other.
 *
 *   Kept duplicated from notifications-server.ts on purpose: the two manifests
 *   carry different shapes and have different access patterns (push gets
 *   write-heavy at subscription time, notifications gets write-rarely-from-UI).
 *   A future refactor can extract a shared "manifest-issue helper".
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
  EMPTY_PUSH_MANIFEST,
  PUSH_SUBSCRIPTIONS_LABEL,
  PUSH_MANIFEST_ISSUE_TITLE,
  parsePushManifestBody,
  serializePushManifestBody,
  type PushSubscriptionsManifest,
  type PushSubscriptionRecord,
} from "./push";

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
  manifest: PushSubscriptionsManifest;
}

async function readPushManifestFresh(): Promise<ManifestRef> {
  const issues = await fetchIssues({
    state: "open",
    labels: PUSH_SUBSCRIPTIONS_LABEL,
    perPage: 5,
    noCache: true,
  });
  if (!issues.length) {
    return {
      number: null,
      manifest: { ...EMPTY_PUSH_MANIFEST, subscriptions: [] },
    };
  }
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number, { noCache: true });
  return {
    number: first.number,
    manifest: parsePushManifestBody(full?.body ?? ""),
  };
}

async function writeManifest(
  next: PushSubscriptionsManifest,
  existingNumber: number | null,
  userOctokit?: Octokit,
): Promise<number> {
  const body = serializePushManifestBody(next);
  if (existingNumber !== null) {
    await updateIssue(existingNumber, { body }, userOctokit);
    return existingNumber;
  }
  const created = await createIssue(
    {
      title: PUSH_MANIFEST_ISSUE_TITLE,
      body,
      labels: [PUSH_SUBSCRIPTIONS_LABEL],
    },
    userOctokit,
  );
  return created.number;
}

function subscriptionsEqual(
  a: PushSubscriptionRecord,
  b: PushSubscriptionRecord,
): boolean {
  return (
    a.endpoint === b.endpoint &&
    a.keys.p256dh === b.keys.p256dh &&
    a.keys.auth === b.keys.auth &&
    (a.label ?? null) === (b.label ?? null) &&
    (a.userLogin ?? null) === (b.userLogin ?? null) &&
    a.createdAt === b.createdAt &&
    (a.lastSeenAt ?? null) === (b.lastSeenAt ?? null)
  );
}

function manifestsEqual(
  a: PushSubscriptionsManifest,
  b: PushSubscriptionsManifest,
): boolean {
  if (a.subscriptions.length !== b.subscriptions.length) return false;
  for (let i = 0; i < a.subscriptions.length; i++) {
    if (!subscriptionsEqual(a.subscriptions[i], b.subscriptions[i]))
      return false;
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
  manifest: PushSubscriptionsManifest;
  issueNumber: number;
}

export type MutatorReturn<T> =
  | { next: PushSubscriptionsManifest; result: T }
  | { kind: "noop"; result: T };

export type Mutator<T> = (
  current: PushSubscriptionsManifest,
) => MutatorReturn<T> | Promise<MutatorReturn<T>>;

export async function mutatePushManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  const lockKey = `push:${getOwner()}/${getRepo()}`;
  const maxAttempts = options.maxAttempts ?? 3;

  return withRepoLock(lockKey, async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await readPushManifestFresh();
      const mutation = await mutator(ref.manifest);
      if ("kind" in mutation && mutation.kind === "noop") {
        return { kind: "noop" as const, result: mutation.result };
      }
      const written = mutation as {
        next: PushSubscriptionsManifest;
        result: T;
      };
      const issueNumber = await writeManifest(
        written.next,
        ref.number,
        options.userOctokit,
      );
      invalidateIssueCache(issueNumber);

      const verify = await fetchIssue(issueNumber, { noCache: true });
      const verifyManifest = parsePushManifestBody(verify?.body ?? "");
      if (manifestsEqual(verifyManifest, written.next)) {
        return {
          result: written.result,
          manifest: written.next,
          issueNumber,
        };
      }
      lastError = new Error(
        `push manifest write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(50 * attempt + Math.floor(Math.random() * 50));
    }
    throw (
      lastError ??
      new Error(
        `push manifest write conflict: failed after ${maxAttempts} attempts`,
      )
    );
  });
}

export async function readPushManifest(): Promise<ManifestRef> {
  return readPushManifestFresh();
}
