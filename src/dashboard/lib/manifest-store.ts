/**
 * @fileType utility
 * @domain kody
 * @pattern manifest-issue-cas
 * @ai-summary Generic "manifest stored in a GitHub issue body" store. One
 *   factory replaces the five hand-copied helpers (goals / push /
 *   notifications / inbox-feed) that each carried an
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
import { INTERNAL_ISSUE_LABEL } from "./constants";

/**
 * GitHub rejects issue bodies over 65,536 chars with a 422; a rejected PATCH
 * then reads back unchanged and the CAS verify falsely reports "write conflict"
 * → the manifest silently freezes. We keep the default budget well below the
 * hard limit so preamble/fences/markers always fit. Each store can override.
 *
 * Past regression (inbox-feed): bloated past 65,536 → every append turned into
 * a bogus retry storm. Fixed there by capping entries; this is the same guard
 * promoted into the shared core so the other 4 stores can't repeat it.
 */
export const DEFAULT_MAX_BODY_BYTES = 60_000;

/**
 * Thrown when `serialize(beforeWrite(next))` exceeds the configured byte
 * budget. Carries the actual size + budget so callers (and our agentResponsibility-failure
 * dispatch) can surface a useful error instead of pretending it's a conflict.
 */
export class ManifestBodyTooLargeError extends Error {
  readonly name = "ManifestBodyTooLargeError";
  constructor(
    public readonly manifestName: string,
    public readonly bytes: number,
    public readonly maxBytes: number,
  ) {
    super(
      `${manifestName} body is ${bytes} bytes, over the ${maxBytes}-byte budget. Refusing to write — GitHub would reject it at 65536 and the CAS loop would loop on a bogus conflict.`,
    );
  }
}

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
  /**
   * Per-store last-chance trim invoked right before write. Use it to drop
   * oldest entries so the serialized body stays under `maxBodyBytes` for
   * unbounded growth stores (push subs, inbox feed, …). Curated lists
   * (goals, notification rules) can omit it — the byte guard will throw a
   * clean `ManifestBodyTooLargeError` instead of silently looping.
   */
  beforeWrite?: (manifest: M) => M;
  /**
   * Hard byte ceiling on the serialized body. Default `DEFAULT_MAX_BODY_BYTES`.
   * Override only if a store has a different headroom budget (e.g. inbox-feed
   * uses 50,000 because its preamble is shorter and entries are fatter).
   */
  maxBodyBytes?: number;
}

export interface ManifestStore<M> {
  /**
   * Cache-bypassing read for write paths: returns the issue number (or null)
   * plus the parsed manifest.
   */
  readFresh(): Promise<ManifestRef<M>>;
  /**
   * Cached read (ETag/304) for poll/read-only callers that don't need the
   * issue number. Used by inbox-feed.
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
  const beforeWrite = config.beforeWrite ?? ((m: M) => m);
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

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

  /**
   * Returns the safe-to-write manifest + its serialized body. Applies the
   * per-store `beforeWrite` trim, then guards on `maxBodyBytes`. Throws
   * `ManifestBodyTooLargeError` if the trim couldn't get under budget — the
   * mutate loop catches and surfaces this instead of falsely retrying.
   */
  function prepareForWrite(next: M): { safe: M; body: string } {
    const safe = beforeWrite(next);
    const body = serialize(safe);
    if (body.length > maxBodyBytes) {
      throw new ManifestBodyTooLargeError(name, body.length, maxBodyBytes);
    }
    return { safe, body };
  }

  async function write(
    body: string,
    existingNumber: number | null,
    userOctokit?: Octokit,
  ): Promise<number> {
    if (existingNumber !== null) {
      await updateIssue(existingNumber, { body }, userOctokit);
      return existingNumber;
    }
    const created = await createIssue(
      // Stamp the umbrella label alongside the per-manifest discovery label so
      // the task list (and any future reader) can exclude all infra issues by
      // one label. Discovery still keys off `label` (see pickIssueNumber).
      { title, body, labels: [label, INTERNAL_ISSUE_LABEL] },
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
        // prepareForWrite applies beforeWrite + byte-budget guard. A
        // ManifestBodyTooLargeError surfaces immediately (no retry) — retrying
        // wouldn't shrink the body, so looping is just wasted GitHub budget.
        const { safe, body } = prepareForWrite(written.next);
        const issueNumber = await write(body, ref.number, options.userOctokit);
        invalidateIssueCache(issueNumber);

        // Verify: re-read with noCache; if the body doesn't match what we
        // wrote, a concurrent writer landed after us — retry from a fresh
        // read.
        const verify = await fetchIssue(issueNumber, { noCache: true });
        const verifyManifest = parse(verify?.body ?? "");

        if (equals(verifyManifest, safe)) {
          return {
            result: written.result,
            manifest: safe,
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
        new Error(
          `${name} write conflict: failed after ${maxAttempts} attempts`,
        )
      );
    });
  }

  return { readFresh, readCached, mutate };
}
