/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-cas
 * @ai-summary Server-only notifications-manifest helpers. The read → mutate →
 *   write → verify cycle (in-process per-repo mutex + retry) now lives in the
 *   shared `manifest-store` core; this file is just the notifications-specific
 *   config plus the original public API (names/signatures unchanged).
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
  NOTIFICATIONS_MANIFEST_LABEL,
  MANIFEST_ISSUE_TITLE,
  parseManifestBody,
  serializeManifestBody,
  type NotificationsManifest,
  type NotificationRule,
} from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify — field-by-field per rule; channel compared by JSON.stringify
// (scalar fields, non-overlapping union shapes — matches serialized bytes)
// ─────────────────────────────────────────────────────────────────────────────

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

const store = createManifestStore<NotificationsManifest>({
  label: NOTIFICATIONS_MANIFEST_LABEL,
  title: MANIFEST_ISSUE_TITLE,
  name: "notifications manifest",
  parse: parseManifestBody,
  serialize: serializeManifestBody,
  empty: () => ({ ...EMPTY_MANIFEST, rules: [] }),
  equals: manifestsEqual,
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export type MutateOptions = ManifestMutateOptions;
export type MutationOutcome<T> = ManifestMutationOutcome<
  NotificationsManifest,
  T
>;
export type MutatorReturn<T> = ManifestMutatorReturn<NotificationsManifest, T>;
export type Mutator<T> = ManifestMutator<NotificationsManifest, T>;

export function mutateNotificationsManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  return store.mutate(mutator, options);
}

/**
 * Read-only fresh accessor for the webhook handler / dispatcher (cache
 * bypass — the dispatcher should always see the latest rule state).
 */
export function readNotificationsManifestFresh(): Promise<
  ManifestRef<NotificationsManifest>
> {
  return store.readFresh();
}
