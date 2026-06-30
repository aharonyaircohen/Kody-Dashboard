/**
 * @fileType utility
 * @domain kody
 * @pattern brain-app-file-store
 * @ai-summary Per-user record of the Brain Fly app the dashboard provisioned.
 *   One JSON file per GitHub login at
 *   `users/<login>/data/brain.json` at the root of the configured Kody
 *   state repo.
 *
 *   Mirrors `notifications/prefs-store.ts`: ETag/If-None-Match for free 304s,
 *   CAS writes (fetch SHA → write with SHA → retry once on 409). The folder
 *   shape (`users/<login>/data/…`) is intentionally a folder per user so
 *   future per-user data files (`preferences.json`, `settings.json`, …) can
 *   sit alongside `brain.json` without colliding.
 *
 *   This file is the source of truth for the Runner page: it surfaces
 *   "here is the Fly app we believe you have, and the org we put it in" so
 *   the user can terminate it from the UI even if the Fly token can no
 *   longer see the app (the orphan case — token revoked, app moved to a
 *   different org, etc.).
 */
import "server-only";

import { getOctokit, getOwner, getRepo } from "../github-client";
import { deleteStateFile, readStateText, writeStateText } from "../state-repo";

/** TTL for brain app cache. Low-churn data — 5 min matches the prefs store. */
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Exported for unit tests — clears all brain-store cache entries. */
export function _resetBrainAppCache(): void {
  for (const key of cache.keys()) {
    if (
      key.startsWith("brain-app:") ||
      key.startsWith("brain-image:") ||
      key.startsWith("brain-image-save:")
    ) {
      cache.delete(key);
    }
  }
}

function getCache<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, etag: entry.etag };
}

function setCache<T>(key: string, data: T, etag?: string): void {
  cache.set(key, { data, expires: Date.now() + BRAIN_CACHE_TTL_MS, etag });
}

function cacheKey(kind: "app" | "image" | "image-save", login: string): string {
  return `brain-${kind}:${login.toLowerCase()}`;
}

function appFilePath(login: string): string {
  return `users/${login.toLowerCase()}/data/brain.json`;
}

function imageFilePath(login: string): string {
  return `users/${login.toLowerCase()}/data/brain-image.json`;
}

function imageSaveFilePath(login: string): string {
  return `users/${login.toLowerCase()}/data/brain-image-save.json`;
}

/** Persisted Brain app record. Versioned for future migrations. */
export interface BrainAppFile {
  version: 1;
  appName: string;
  orgSlug: string;
  createdAt: string;
}

/** Persisted Brain image record. Stores only the GHCR image ref. */
export interface BrainImageFile {
  version: 1;
  imageRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainImageSaveFile {
  version: 1;
  status: "running" | "completed" | "failed";
  jobId: string;
  app: string;
  machineId: string;
  bridgeApp: string;
  orgSlug: string;
  defaultRegion: string;
  expectedImageRef: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

function isBrainAppFile(value: unknown): value is BrainAppFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.appName === "string" &&
    v.appName.length > 0 &&
    typeof v.orgSlug === "string" &&
    typeof v.createdAt === "string"
  );
}

export function isValidBrainImageRef(value: string): boolean {
  return /^ghcr\.io\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:@sha256:[a-f0-9]{64})?$/.test(
    value,
  );
}

function isBrainImageFile(value: unknown): value is BrainImageFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

function isBrainImageSaveFile(value: unknown): value is BrainImageSaveFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    (v.status === "running" ||
      v.status === "completed" ||
      v.status === "failed") &&
    typeof v.jobId === "string" &&
    /^[a-f0-9]{32}$/.test(v.jobId) &&
    typeof v.app === "string" &&
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(v.app) &&
    typeof v.machineId === "string" &&
    v.machineId.length > 0 &&
    v.machineId.length <= 120 &&
    typeof v.bridgeApp === "string" &&
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(v.bridgeApp) &&
    typeof v.orgSlug === "string" &&
    v.orgSlug.length > 0 &&
    typeof v.defaultRegion === "string" &&
    v.defaultRegion.length > 0 &&
    typeof v.expectedImageRef === "string" &&
    isValidBrainImageRef(v.expectedImageRef) &&
    typeof v.startedAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.error === undefined || typeof v.error === "string")
  );
}

/**
 * Read the Brain app record for a user from the configured Kody state repo.
 * Returns `null` when no record exists (user has never provisioned, or the
 * file was deleted). Throws on non-404 GitHub errors so the caller can
 * surface a real failure.
 */
export async function readBrainApp(
  login: string,
  _token: string,
): Promise<BrainAppFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = appFilePath(login);
  const key = cacheKey("app", login);

  const cached = getCache<BrainAppFile | null>(key);
  const octokit = getOctokit();

  try {
    const file = await readStateText(octokit, owner, repo, path, {
      scope: "root",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const parsed: unknown = JSON.parse(file.content);
      if (!isBrainAppFile(parsed)) {
        setCache(key, null, file.etag);
        return null;
      }
      setCache(key, parsed, file.etag);
      return parsed;
    }
    const legacyFile = await readStateText(octokit, owner, repo, path);
    if (legacyFile) {
      const parsed: unknown = JSON.parse(legacyFile.content);
      if (!isBrainAppFile(parsed)) {
        setCache(key, null, legacyFile.etag);
        return null;
      }
      setCache(key, parsed, legacyFile.etag);
      return parsed;
    }
    setCache(key, null);
    return null;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      setCache(key, cached.data, cached.etag);
      return cached.data;
    }
    if (status === 404) {
      setCache(key, null);
      return null;
    }
    throw error;
  }
}

/**
 * Write the Brain app record for a user to the configured Kody state repo. Uses CAS:
 * fetches the current SHA, then writes with it. Retries once on 409.
 */
export async function writeBrainApp(
  login: string,
  _token: string,
  file: BrainAppFile,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = appFilePath(login);
  const key = cacheKey("app", login);

  cache.delete(key);

  let sha: string | undefined;

  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    sha = current?.sha;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== 404) throw error;
  }

  const content = JSON.stringify(file, null, 2);
  const message = `feat(brain): record brain app for ${login}`;

  try {
    const octokit = getOctokit();
    await writeStateText({
      octokit,
      owner,
      repo,
      path,
      message,
      content,
      sha,
      scope: "root",
    });
    return;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 409) {
      try {
        const octokit = getOctokit();
        const current = await readStateText(octokit, owner, repo, path, {
          scope: "root",
        });
        await writeStateText({
          octokit,
          owner,
          repo,
          path,
          message,
          content,
          sha: current?.sha,
          scope: "root",
        });
        return;
      } catch {
        // fall through to throw
      }
    }
    throw error;
  }
}

/**
 * Delete the Brain app record for a user from the configured Kody state repo.
 * Idempotent — returns silently if the file doesn't exist. Best-effort:
 * the Brain record is metadata; if clearing fails the caller can still
 * proceed (the next write will overwrite).
 */
export async function clearBrainApp(
  login: string,
  _token: string,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = appFilePath(login);
  const key = cacheKey("app", login);

  cache.delete(key);

  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    if (current?.sha) {
      await deleteStateFile({
        octokit,
        owner,
        repo,
        path,
        message: `feat(brain): clear brain app for ${login}`,
        sha: current.sha,
        scope: "root",
      });
    }
    const legacy = await readStateText(octokit, owner, repo, path);
    if (legacy?.sha) {
      await deleteStateFile({
        octokit,
        owner,
        repo,
        path,
        message: `feat(brain): clear legacy repo brain app for ${login}`,
        sha: legacy.sha,
      });
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return;
    throw error;
  }
}

export async function readBrainImage(
  login: string,
  _token: string,
): Promise<BrainImageFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = imageFilePath(login);
  const key = cacheKey("image", login);

  const cached = getCache<BrainImageFile | null>(key);
  const octokit = getOctokit();

  try {
    const file = await readStateText(octokit, owner, repo, path, {
      scope: "root",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const parsed: unknown = JSON.parse(file.content);
      if (!isBrainImageFile(parsed)) {
        setCache(key, null, file.etag);
        return null;
      }
      setCache(key, parsed, file.etag);
      return parsed;
    }
    const legacyFile = await readStateText(octokit, owner, repo, path);
    if (legacyFile) {
      const parsed: unknown = JSON.parse(legacyFile.content);
      if (!isBrainImageFile(parsed)) {
        setCache(key, null, legacyFile.etag);
        return null;
      }
      setCache(key, parsed, legacyFile.etag);
      return parsed;
    }
    setCache(key, null);
    return null;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      setCache(key, cached.data, cached.etag);
      return cached.data;
    }
    if (status === 404) {
      setCache(key, null);
      return null;
    }
    throw error;
  }
}

export async function writeBrainImage(
  login: string,
  _token: string,
  file: BrainImageFile,
): Promise<void> {
  if (!isBrainImageFile(file)) {
    throw new Error("Invalid Brain image record");
  }
  const owner = getOwner();
  const repo = getRepo();
  const path = imageFilePath(login);
  const key = cacheKey("image", login);

  cache.delete(key);

  let sha: string | undefined;
  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    sha = current?.sha;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== 404) throw error;
  }

  const content = JSON.stringify(file, null, 2);
  const message = `feat(brain): record brain image for ${login}`;

  try {
    const octokit = getOctokit();
    await writeStateText({
      octokit,
      owner,
      repo,
      path,
      message,
      content,
      sha,
      scope: "root",
    });
    return;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 409) {
      try {
        const octokit = getOctokit();
        const current = await readStateText(octokit, owner, repo, path, {
          scope: "root",
        });
        await writeStateText({
          octokit,
          owner,
          repo,
          path,
          message,
          content,
          sha: current?.sha,
          scope: "root",
        });
        return;
      } catch {
        // fall through to throw
      }
    }
    throw error;
  }
}

export async function readBrainImageSave(
  login: string,
  _token: string,
): Promise<BrainImageSaveFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = imageSaveFilePath(login);
  const key = cacheKey("image-save", login);

  const cached = getCache<BrainImageSaveFile | null>(key);
  const octokit = getOctokit();

  try {
    const file = await readStateText(octokit, owner, repo, path, {
      scope: "root",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const parsed: unknown = JSON.parse(file.content);
      if (!isBrainImageSaveFile(parsed)) {
        setCache(key, null, file.etag);
        return null;
      }
      setCache(key, parsed, file.etag);
      return parsed;
    }
    const legacyFile = await readStateText(octokit, owner, repo, path);
    if (legacyFile) {
      const parsed: unknown = JSON.parse(legacyFile.content);
      if (!isBrainImageSaveFile(parsed)) {
        setCache(key, null, legacyFile.etag);
        return null;
      }
      setCache(key, parsed, legacyFile.etag);
      return parsed;
    }
    setCache(key, null);
    return null;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      setCache(key, cached.data, cached.etag);
      return cached.data;
    }
    if (status === 404) {
      setCache(key, null);
      return null;
    }
    throw error;
  }
}

export async function writeBrainImageSave(
  login: string,
  _token: string,
  file: BrainImageSaveFile,
): Promise<void> {
  if (!isBrainImageSaveFile(file)) {
    throw new Error("Invalid Brain image save record");
  }
  const owner = getOwner();
  const repo = getRepo();
  const path = imageSaveFilePath(login);
  const key = cacheKey("image-save", login);

  cache.delete(key);

  let sha: string | undefined;
  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    sha = current?.sha;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== 404) throw error;
  }

  const content = JSON.stringify(file, null, 2);
  const message = `feat(brain): record brain image save job for ${login}`;

  try {
    const octokit = getOctokit();
    await writeStateText({
      octokit,
      owner,
      repo,
      path,
      message,
      content,
      sha,
      scope: "root",
    });
    return;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 409) {
      try {
        const octokit = getOctokit();
        const current = await readStateText(octokit, owner, repo, path, {
          scope: "root",
        });
        await writeStateText({
          octokit,
          owner,
          repo,
          path,
          message,
          content,
          sha: current?.sha,
          scope: "root",
        });
        return;
      } catch {
        // fall through to throw
      }
    }
    throw error;
  }
}

export async function clearBrainImageSave(
  login: string,
  _token: string,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = imageSaveFilePath(login);
  const key = cacheKey("image-save", login);

  cache.delete(key);

  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    if (current?.sha) {
      await deleteStateFile({
        octokit,
        owner,
        repo,
        path,
        message: `feat(brain): clear brain image save job for ${login}`,
        sha: current.sha,
        scope: "root",
      });
    }
    const legacy = await readStateText(octokit, owner, repo, path);
    if (legacy?.sha) {
      await deleteStateFile({
        octokit,
        owner,
        repo,
        path,
        message: `feat(brain): clear legacy repo brain image save job for ${login}`,
        sha: legacy.sha,
      });
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return;
    throw error;
  }
}
