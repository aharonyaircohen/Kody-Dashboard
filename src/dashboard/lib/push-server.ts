/**
 * @fileType utility
 * @domain kody
 * @pattern push-subscriptions-cas
 * @ai-summary Server-only helpers for the push-subscriptions manifest issue.
 *   The read → mutate → write → verify cycle (in-process per-repo mutex +
 *   retry) now lives in the shared `manifest-store` core; this file is just
 *   the push-specific config plus the original public API (names/signatures
 *   unchanged).
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
  EMPTY_PUSH_MANIFEST,
  PUSH_SUBSCRIPTIONS_LABEL,
  PUSH_MANIFEST_ISSUE_TITLE,
  parsePushManifestBody,
  serializePushManifestBody,
  type PushSubscriptionsManifest,
  type PushSubscriptionRecord,
} from "./push";

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify — two-level field-by-field (manifest → each subscription)
// ─────────────────────────────────────────────────────────────────────────────

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

const store = createManifestStore<PushSubscriptionsManifest>({
  label: PUSH_SUBSCRIPTIONS_LABEL,
  title: PUSH_MANIFEST_ISSUE_TITLE,
  name: "push manifest",
  lockPrefix: "push:",
  parse: parsePushManifestBody,
  serialize: serializePushManifestBody,
  empty: () => ({ ...EMPTY_PUSH_MANIFEST, subscriptions: [] }),
  equals: manifestsEqual,
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export type MutateOptions = ManifestMutateOptions;
export type MutationOutcome<T> = ManifestMutationOutcome<
  PushSubscriptionsManifest,
  T
>;
export type MutatorReturn<T> = ManifestMutatorReturn<
  PushSubscriptionsManifest,
  T
>;
export type Mutator<T> = ManifestMutator<PushSubscriptionsManifest, T>;

export function mutatePushManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  return store.mutate(mutator, options);
}

export function readPushManifest(): Promise<
  ManifestRef<PushSubscriptionsManifest>
> {
  return store.readFresh();
}
