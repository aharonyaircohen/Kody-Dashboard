/**
 * @fileType utility
 * @domain kody
 * @pattern manifest-issue-cas
 * @ai-summary Generic "manifest stored in a GitHub issue body" store. One
 *   factory replaces the five hand-copied helpers (goals / push /
 *   notifications / cto-decisions / inbox-feed) that each carried an
 *   identical read → mutate → write → verify cycle wrapped in an
 *   in-process per-repo mutex.
 *
 * Why this exists:
 *   Each manifest lived in a single GitHub issue body. GitHub's issue PATCH
 *   endpoint has no `If-Match`, so every consumer independently re-implemented
 *   the same compare-and-swap: serialize within the Vercel instance via a
 *   per-repo mutex, write, re-read with `noCache: true`, and retry from a
 *   fresh read if the body doesn't match what we wrote. That ~40-line block
 *   was copy-pasted five times; a bug fixed in one stayed broken in four.
 *   This module is that block, written once. Each entity supplies only what
 *   genuinely differs: label, title, parse/serialize, an empty factory, an
 *   equality check, and (optionally) a lock-key prefix.
 *
 * Limits (unchanged from the originals):
 *   The mutex is per-Vercel-instance. Cross-instance contention is mitigated
 *   by the verify-after-write check (re-read `noCache: true`, retry on
 *   mismatch). A stronger guarantee needs a real distributed lock or moving
 *   the manifest off a GitHub issue body.
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-repo mutex (verbatim from the originals — chain onto the tail so the
// next caller waits on us; we don't care about the previous result, only
// that it has settled)
// ─────────────────────────────────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>();

export async function withRepoLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Public types (each entity re-exports these concretely so its 1-2 call
// sites keep compiling against the exact same names/signatures)
// ─────────────────────────────────────────────────────────────────────────────

export interface ManifestRef<M> {
  number: number | null;
  manifest: M;
}

export interface ManifestMutateOptions {
  userOctokit?: Octokit;
  /** Max attempts on cross-instance write conflict. Default 3. */
  maxAttempts?: number;
}

export interface ManifestMutationOutcome<M, T> {
  /** The mutator's chosen response value. */
  result: T;
  /** The manifest we just wrote. */
  manifest: M;
  /** The manifest issue number we wrote to (created or existing). */
  issueNumber: number;
}

export type ManifestMutatorReturn<M, T> =
  | { next: M; result: T }
  | { kind: "noop"; result: T };

export type ManifestMutator<M, T> = (
  current: M,
) => ManifestMutatorReturn<M, T> | Promise<ManifestMutatorReturn<M, T>>;

export interface ManifestStoreConfig<M> {
  /** Issue label used for discovery + create (e.g. `kody:goals-manifest`). */
  label: string;
  /** Title used when creating the manifest issue. */
  title: string;
  /**
   * Human name used only in the write-conflict error string, to keep the
   * thrown message byte-identical to the pre-refactor helpers.
   */
  name: string;
  /** Lock-key prefix (e.g. `push:`). Default "". */
  lockPrefix?: string;
  parse: (body: string | null | undefined) => M;
  serialize: (manifest: M) => string;
  /** Fresh empty manifest (a factory — never share a mutable instance). */
  empty: () => M;
  /** No-op-skip / verify-after-write equality (per-entity strategy). */
  equals: (a: M, b: M) => boolean;
}

export interface ManifestStore<M> {
  /**
   * Cache-bypassing read for write paths: returns the issue number (or null)
   * plus the parsed manifest.
   */
  readFresh(): Promise<ManifestRef<M>>;
  /**
   * Cached read (ETag/304) for poll/read-only callers that don't need the
   * issue number. Used by cto-decisions + inbox-feed.
   */
  readCached(): Promise<M>;
  /**
   * Read fresh → run mutator → write → verify; serialized per-repo, retried
   * from a fresh read on cross-instance conflict. The mutator may return
   * `{ kind: 'noop', result }` to abort the write while still returning a
   * value.
   */
  mutate<T>(
    mutator: ManifestMutator<M, T>,
    options?: ManifestMutateOptions,
  ): Promise<ManifestMutationOutcome<M, T> | { kind: "noop"; result: T }>;
}

export function createManifestStore<M>(
  config: ManifestStoreConfig<M>,
): ManifestStore<M> {
  const { label, title, name, parse, serialize, empty, equals } = config;
  const lockPrefix = config.lockPrefix ?? "";

  async function pickIssueNumber(noCache: boolean): Promise<number | null> {
    const issues = await fetchIssues({
      state: "open",
      labels: label,
      perPage: 5,
      ...(noCache ? { noCache: true } : {}),
    });
    if (!issues.length) return null;
    return [...issues].sort((a, b) => a.number - b.number)[0].number;
  }

  async function readFresh(): Promise<ManifestRef<M>> {
    const number = await pickIssueNumber(true);
    if (number === null) return { number: null, manifest: empty() };
    const full = await fetchIssue(number, { noCache: true });
    return { number, manifest: parse(full?.body ?? "") };
  }

  async function readCached(): Promise<M> {
    const number = await pickIssueNumber(false);
    if (number === null) return empty();
    const full = await fetchIssue(number);
    return parse(full?.body ?? "");
  }

  async function write(
    next: M,
    existingNumber: number | null,
    userOctokit?: Octokit,
  ): Promise<number> {
    const body = serialize(next);
    if (existingNumber !== null) {
      await updateIssue(existingNumber, { body }, userOctokit);
      return existingNumber;
    }
    const created = await createIssue(
      { title, body, labels: [label] },
      userOctokit,
    );
    return created.number;
  }

  async function mutate<T>(
    mutator: ManifestMutator<M, T>,
    options: ManifestMutateOptions = {},
  ): Promise<ManifestMutationOutcome<M, T> | { kind: "noop"; result: T }> {
    const lockKey = `${lockPrefix}${getOwner()}/${getRepo()}`;
    const maxAttempts = options.maxAttempts ?? 3;

    return withRepoLock(lockKey, async () => {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ref = await readFresh();
        const mutation = await mutator(ref.manifest);

        if ("kind" in mutation && mutation.kind === "noop") {
          return { kind: "noop" as const, result: mutation.result };
        }

        const written = mutation as { next: M; result: T };
        const issueNumber = await write(
          written.next,
          ref.number,
          options.userOctokit,
        );
        invalidateIssueCache(issueNumber);

        // Verify: re-read with noCache; if the body doesn't match what we
        // wrote, a concurrent writer landed after us — retry from a fresh
        // read.
        const verify = await fetchIssue(issueNumber, { noCache: true });
        const verifyManifest = parse(verify?.body ?? "");

        if (equals(verifyManifest, written.next)) {
          return {
            result: written.result,
            manifest: written.next,
            issueNumber,
          };
        }

        lastError = new Error(
          `${name} write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
        );
        await sleep(50 * attempt + Math.floor(Math.random() * 50));
      }

      throw (
        lastError ??
        new Error(`${name} write conflict: failed after ${maxAttempts} attempts`)
      );
    });
  }

  return { readFresh, readCached, mutate };
}
