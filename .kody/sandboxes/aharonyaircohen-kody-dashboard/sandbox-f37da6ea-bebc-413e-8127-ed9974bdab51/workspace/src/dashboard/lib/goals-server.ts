/**
 * @fileType utility
 * @domain kody
 * @pattern goals-cas
 * @ai-summary Server-only goals-manifest helpers. The read → mutate → write →
 *   verify cycle (in-process per-repo mutex + retry) now lives in the shared
 *   `manifest-store` core; this file is just the goals-specific config plus
 *   the original public API (names/signatures unchanged so all callers and
 *   the `Mutator<T>` type stay byte-identical).
 *
 * Goals live in a single GitHub issue body. GitHub's issue PATCH endpoint
 * doesn't support `If-Match`, so the core serializes within the instance and
 * verifies after write — see manifest-store.ts for the rationale and limits.
 */
import {
  createManifestStore,
  type ManifestRef,
  type ManifestMutateOptions,
  type ManifestMutationOutcome,
  type ManifestMutator,
  type ManifestMutatorReturn,
} from "./manifest-store";
import {
  EMPTY_MANIFEST,
  GOALS_MANIFEST_LABEL,
  MANIFEST_ISSUE_TITLE,
  parseManifestBody,
  serializeManifestBody,
  type GoalsManifest,
} from "./goals";

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify — goals compare field-by-field (order-sensitive)
// ─────────────────────────────────────────────────────────────────────────────

function manifestsEqual(a: GoalsManifest, b: GoalsManifest): boolean {
  if (a.goals.length !== b.goals.length) return false;
  for (let i = 0; i < a.goals.length; i++) {
    const ga = a.goals[i];
    const gb = b.goals[i];
    if (
      ga.id !== gb.id ||
      ga.name !== gb.name ||
      (ga.description ?? null) !== (gb.description ?? null) ||
      (ga.dueDate ?? null) !== (gb.dueDate ?? null) ||
      ga.createdAt !== gb.createdAt ||
      (ga.updatedAt ?? null) !== (gb.updatedAt ?? null) ||
      (ga.discussionId ?? null) !== (gb.discussionId ?? null) ||
      (ga.discussionNumber ?? null) !== (gb.discussionNumber ?? null) ||
      (ga.assignee ?? null) !== (gb.assignee ?? null)
    ) {
      return false;
    }
  }
  return true;
}

const store = createManifestStore<GoalsManifest>({
  label: GOALS_MANIFEST_LABEL,
  title: MANIFEST_ISSUE_TITLE,
  name: "goals manifest",
  parse: parseManifestBody,
  serialize: serializeManifestBody,
  empty: () => ({ ...EMPTY_MANIFEST, goals: [] }),
  equals: manifestsEqual,
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export type MutateOptions = ManifestMutateOptions;
export type MutationOutcome<T> = ManifestMutationOutcome<GoalsManifest, T>;
export type MutatorReturn<T> = ManifestMutatorReturn<GoalsManifest, T>;
export type Mutator<T> = ManifestMutator<GoalsManifest, T>;

/**
 * Read the manifest fresh, run the mutator, write it back, verify. Serialized
 * per-repo; retries on cross-instance conflict. The mutator may return
 * `{ kind: 'noop', result }` to abort the write while still returning a value
 * (e.g. goal-id not found → respond 404).
 */
export function mutateGoalsManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  return store.mutate(mutator, options);
}

/**
 * Read-only manifest accessor for write-path routes that need the issue
 * number. Bypasses the cache. The polled GET path keeps its own cached read.
 */
export function readGoalsManifestFresh(): Promise<ManifestRef<GoalsManifest>> {
  return store.readFresh();
}
