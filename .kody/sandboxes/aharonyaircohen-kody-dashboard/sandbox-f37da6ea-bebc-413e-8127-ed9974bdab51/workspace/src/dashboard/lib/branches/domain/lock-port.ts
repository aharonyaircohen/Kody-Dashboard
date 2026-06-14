/**
 * @fileType module
 * @domain branches
 * @ai-summary Pure port for acquiring mutually-exclusive leases on a
 *   string key. Implementations live in `infra/` (e.g. a GitHub-file
 *   backed lock for production, an in-memory fake for tests).
 *
 *   Used by `BranchService.getOrCreate` to prevent two concurrent vibe
 *   sessions on the same issue from racing past the foreign-branch
 *   guard (issue exists → both branch-create attempts pass 422 →
 *   both think they own the branch).
 *
 *   Semantics:
 *   - `acquire(key, ttlMs)` returns a `Lease` on success, `null` on
 *     contention (another caller holds the lock and its TTL has not
 *     yet expired).
 *   - The TTL is a CRASH-SAFETY mechanism, not a queue-fairness one.
 *     If a holder crashes, the lock auto-releases after TTL so the
 *     next acquirer isn't stuck forever.
 *   - `release()` is idempotent — calling it on a lease whose TTL
 *     already expired is a no-op.
 */

export interface Lease {
  /** Release the lease. Safe to call multiple times. */
  release(): Promise<void>;
}

export interface LockPort {
  /**
   * Try to acquire a lease on `key`. Returns the lease on success,
   * `null` if another caller already holds it (and the TTL hasn't
   * expired).
   */
  acquire(key: string, ttlMs: number): Promise<Lease | null>;
}
