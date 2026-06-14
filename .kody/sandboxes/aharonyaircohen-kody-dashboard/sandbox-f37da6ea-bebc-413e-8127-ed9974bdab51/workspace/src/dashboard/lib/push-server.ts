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

/**
 * Hard cap on durable push subscriptions per repo. Each record is ~600 bytes
 * (endpoint URL + two base64 keys + label + timestamps), so 1000 entries fits
 * comfortably under the manifest-store byte budget with plenty of headroom for
 * the JSON wrapper. Trim drops the *least-recently-seen* device first — the
 * least likely to still be alive — so an organic install/uninstall churn never
 * silently freezes new sign-ups.
 */
const MAX_PUSH_SUBSCRIPTIONS = 1000;

function trimOldestSubscriptions(
  manifest: PushSubscriptionsManifest,
): PushSubscriptionsManifest {
  if (manifest.subscriptions.length <= MAX_PUSH_SUBSCRIPTIONS) return manifest;
  // Recency = lastSeenAt if known, else createdAt. Sort newest-first, slice
  // to the cap, preserve the original order so equals/CAS stays stable.
  const ranked = manifest.subscriptions
    .map((sub, idx) => ({
      sub,
      idx,
      seenAt: sub.lastSeenAt ?? sub.createdAt,
    }))
    .sort((a, b) => (a.seenAt < b.seenAt ? 1 : a.seenAt > b.seenAt ? -1 : 0))
    .slice(0, MAX_PUSH_SUBSCRIPTIONS)
    .sort((a, b) => a.idx - b.idx);
  return { ...manifest, subscriptions: ranked.map((r) => r.sub) };
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
  beforeWrite: trimOldestSubscriptions,
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
