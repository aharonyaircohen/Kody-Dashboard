/**
 * @fileType module
 * @domain branches
 * @pattern lock-adapter
 * @ai-summary GitHub-file-backed implementation of LockPort.
 *
 *   Stores leases as `.kody/locks/<key>.json` in the repo. Mutual
 *   exclusion comes from GitHub's "create file" semantics: PUT with
 *   no `sha` field returns 422 if the file already exists, so two
 *   concurrent creates produce one 201 winner and one 422 loser —
 *   that's our CAS primitive.
 *
 *   Crash-safety: each lock file records an ISO timestamp + TTL.
 *   When `acquire` finds an existing file with an expired TTL, it
 *   takes over (PUT-with-sha, replacing the dead lease).
 *
 *   Why GitHub-file and not Redis/Vercel-KV? The dashboard already
 *   talks to GitHub for everything; adding a new datastore for a
 *   single low-frequency lock is overkill. Throughput is low (one
 *   acquire per vibe session start) and latency is fine (~200ms).
 */
import type { Octokit } from "@octokit/rest";
import { writeGitHubFileWithRetry } from "@dashboard/lib/github-contents-write";
import type { Lease, LockPort } from "../domain/lock-port";

interface OctokitCtx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

interface LockFileContents {
  /** ISO timestamp when the lock was acquired. */
  acquiredAt: string;
  /** TTL in ms — if `Date.now() - acquiredAt > ttlMs`, lease is dead. */
  ttlMs: number;
  /** Free-form identifier for the holder (for debugging). */
  holder?: string;
}

function lockPath(key: string): string {
  // Slashes in `key` would collide with subdirectory paths. Replace
  // with underscores so keys are flat children of .kody/locks/.
  const safeKey = key.replace(/[^a-z0-9._-]/gi, "_");
  return `.kody/locks/${safeKey}.json`;
}

export class GitHubFileLock implements LockPort {
  constructor(private readonly ctx: OctokitCtx) {}

  async acquire(key: string, ttlMs: number): Promise<Lease | null> {
    const path = lockPath(key);
    const contents: LockFileContents = {
      acquiredAt: new Date().toISOString(),
      ttlMs,
    };
    const message = `lock: acquire ${key}`;
    const contentB64 = Buffer.from(JSON.stringify(contents, null, 2)).toString(
      "base64",
    );

    // Step 1: try to CREATE the file (no `sha` → fails with 422 if
    // it already exists).
    try {
      const data = await writeGitHubFileWithRetry(this.ctx.octokit, {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        path,
        message,
        content: contentB64,
        maxAttempts: 1,
      });
      return makeLease(this.ctx, path, data.sha);
    } catch (err) {
      const e = err as { status?: number };
      if (e.status !== 422) {
        // Network error / auth error / quota — propagate.
        throw err;
      }
      // Fall through to step 2: file exists.
    }

    // Step 2: inspect the existing file. If its TTL expired, take over.
    let existing;
    try {
      existing = await this.ctx.octokit.rest.repos.getContent({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        path,
      });
    } catch (err) {
      // Race: someone deleted the file between our create and our read.
      // Retry the create once.
      const e = err as { status?: number };
      if (e.status === 404) {
        return this.acquire(key, ttlMs);
      }
      throw err;
    }

    if (Array.isArray(existing.data) || existing.data.type !== "file") {
      throw new Error(`Lock path ${path} unexpectedly points to a directory`);
    }
    const sha = existing.data.sha;
    const decoded = Buffer.from(existing.data.content, "base64").toString(
      "utf8",
    );

    let parsed: LockFileContents;
    try {
      parsed = JSON.parse(decoded) as LockFileContents;
    } catch {
      // Corrupt lock file — treat as expired and take over.
      parsed = { acquiredAt: new Date(0).toISOString(), ttlMs: 0 };
    }

    const age = Date.now() - new Date(parsed.acquiredAt).getTime();
    if (Number.isFinite(age) && age < parsed.ttlMs) {
      // Held and not expired.
      return null;
    }

    // Expired — take over with a PUT-with-sha (replaces the dead lease).
    try {
      const data = await writeGitHubFileWithRetry(this.ctx.octokit, {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        path,
        message: `lock: take over expired ${key}`,
        content: contentB64,
        sha,
        maxAttempts: 1,
      });
      return makeLease(this.ctx, path, data.sha);
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 409 || e.status === 422) {
        // Another caller already took over in the gap. Treat as held.
        return null;
      }
      throw err;
    }
  }
}

function makeLease(ctx: OctokitCtx, path: string, sha: string | null): Lease {
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      if (!sha) return;
      try {
        await ctx.octokit.rest.repos.deleteFile({
          owner: ctx.owner,
          repo: ctx.repo,
          path,
          message: `lock: release`,
          sha,
        });
      } catch (err) {
        const e = err as { status?: number };
        // 404 means someone else (TTL takeover) already removed it.
        // 409 means our SHA is stale — same idea. Idempotent no-op.
        if (e.status === 404 || e.status === 409) return;
        throw err;
      }
    },
  };
}
