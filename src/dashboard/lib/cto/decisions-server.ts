/**
 * @fileType utility
 * @domain kody
 * @pattern cto-decisions-cas
 * @ai-summary Server-only CAS mutator for the `kody:cto-decisions` manifest
 *   issue. The read → mutate → write → verify cycle (in-process per-repo
 *   mutex + retry) now lives in the shared `manifest-store` core; this file
 *   is just the cto-specific config plus the original public API.
 *
 *   Two intentional differences from the generic shape, preserved here:
 *     - the mutator never returns a noop (always `{ next, result }`), so
 *       `mutateCtoDecisions` resolves to `MutationOutcome<T>` directly;
 *     - `readCtoDecisions` uses the *cached* (ETag/304) read so each inbox
 *       poll doesn't burn GitHub budget — the POST handler already calls
 *       `invalidateIssueCache` after every decision (CLAUDE.md rules 2 & 5).
 */
import type { Octokit } from "@octokit/rest";
import {
  createManifestStore,
  type ManifestMutateOptions,
  type ManifestMutationOutcome,
} from "../manifest-store";
import {
  CTO_DECISIONS_LABEL,
  CTO_DECISIONS_ISSUE_TITLE,
  parseCtoDecisionsBody,
  serializeCtoDecisionsBody,
  type CtoDecisionsManifest,
} from "./decisions";

const store = createManifestStore<CtoDecisionsManifest>({
  label: CTO_DECISIONS_LABEL,
  title: CTO_DECISIONS_ISSUE_TITLE,
  name: "cto-decisions",
  lockPrefix: "cto-decisions:",
  parse: parseCtoDecisionsBody,
  serialize: serializeCtoDecisionsBody,
  empty: () => parseCtoDecisionsBody(null),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export interface MutateOptions extends ManifestMutateOptions {
  userOctokit?: Octokit;
}

export type MutationOutcome<T> = ManifestMutationOutcome<
  CtoDecisionsManifest,
  T
>;

export type Mutator<T> = (current: CtoDecisionsManifest) => {
  next: CtoDecisionsManifest;
  result: T;
};

export async function mutateCtoDecisions<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T>> {
  // The cto mutator never returns a noop, so the core's union collapses to
  // the outcome branch — assert it for the public signature.
  const outcome = await store.mutate<T>((current) => mutator(current), options);
  return outcome as MutationOutcome<T>;
}

/**
 * Cached read of the decisions ledger so the inbox can gate already-decided
 * recommendations without burning the GitHub budget on each poll.
 */
export function readCtoDecisions(): Promise<CtoDecisionsManifest> {
  return store.readCached();
}
