/**
 * @fileType utility
 * @domain kody
 * @pattern cto-decisions-cas
 * @ai-summary Server-only CAS mutator for the `kody:cto-decisions` manifest
 *   issue. Mirrors push-server.ts exactly — per-repo mutex + verify-after-
 *   write retry so two concurrent Approve clicks (or an Approve racing the
 *   CTO tick's read) can't silently clobber the tally.
 *
 *   Duplicated from push-server.ts on purpose, same rationale as the
 *   push/notifications split: distinct manifest shape + access pattern.
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
} from "../github-client";
import {
  CTO_DECISIONS_LABEL,
  CTO_DECISIONS_ISSUE_TITLE,
  parseCtoDecisionsBody,
  serializeCtoDecisionsBody,
  type CtoDecisionsManifest,
} from "./decisions";

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
  manifest: CtoDecisionsManifest;
}

async function readFresh(): Promise<ManifestRef> {
  const issues = await fetchIssues({
    state: "open",
    labels: CTO_DECISIONS_LABEL,
    perPage: 5,
    noCache: true,
  });
  if (!issues.length) {
    return { number: null, manifest: parseCtoDecisionsBody(null) };
  }
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number, { noCache: true });
  return {
    number: first.number,
    manifest: parseCtoDecisionsBody(full?.body ?? ""),
  };
}

async function write(
  next: CtoDecisionsManifest,
  existingNumber: number | null,
  userOctokit?: Octokit,
): Promise<number> {
  const body = serializeCtoDecisionsBody(next);
  if (existingNumber !== null) {
    await updateIssue(existingNumber, { body }, userOctokit);
    return existingNumber;
  }
  const created = await createIssue(
    {
      title: CTO_DECISIONS_ISSUE_TITLE,
      body,
      labels: [CTO_DECISIONS_LABEL],
    },
    userOctokit,
  );
  return created.number;
}

/**
 * Cached read of the decisions ledger so the inbox can gate
 * already-decided recommendations. Unlike `readFresh` (CAS path,
 * `noCache`), this goes through the ETag/304 cache — the POST handler
 * already calls `invalidateIssueCache` after every decision, so reads
 * stay correct without burning the GitHub budget on each inbox poll
 * (CLAUDE.md rate-limit rules 2 & 5).
 */
export async function readCtoDecisions(): Promise<CtoDecisionsManifest> {
  const issues = await fetchIssues({
    state: "open",
    labels: CTO_DECISIONS_LABEL,
    perPage: 5,
  });
  if (!issues.length) return parseCtoDecisionsBody(null);
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number);
  return parseCtoDecisionsBody(full?.body ?? "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MutateOptions {
  userOctokit?: Octokit;
  maxAttempts?: number;
}

export interface MutationOutcome<T> {
  result: T;
  manifest: CtoDecisionsManifest;
  issueNumber: number;
}

export type Mutator<T> = (
  current: CtoDecisionsManifest,
) => { next: CtoDecisionsManifest; result: T };

export async function mutateCtoDecisions<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T>> {
  const lockKey = `cto-decisions:${getOwner()}/${getRepo()}`;
  const maxAttempts = options.maxAttempts ?? 3;

  return withRepoLock(lockKey, async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await readFresh();
      const { next, result } = mutator(ref.manifest);
      const issueNumber = await write(next, ref.number, options.userOctokit);
      invalidateIssueCache(issueNumber);

      const verify = await fetchIssue(issueNumber, { noCache: true });
      const verifyManifest = parseCtoDecisionsBody(verify?.body ?? "");
      if (JSON.stringify(verifyManifest) === JSON.stringify(next)) {
        return { result, manifest: next, issueNumber };
      }
      lastError = new Error(
        `cto-decisions write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(50 * attempt + Math.floor(Math.random() * 50));
    }
    throw (
      lastError ??
      new Error(
        `cto-decisions write conflict: failed after ${maxAttempts} attempts`,
      )
    );
  });
}
