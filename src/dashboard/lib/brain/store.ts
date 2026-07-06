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

export interface BrainSavedImage {
  imageRef: string;
  label?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Persisted Brain image record. Stores the active GHCR ref and saved refs. */
export interface BrainImageFile {
  version: 1;
  imageRef?: string;
  createdAt: string;
  updatedAt: string;
  images: BrainSavedImage[];
  forgottenImageRefs?: string[];
  runningImageRef?: string;
  runningAt?: string;
  runningApp?: string;
  runningMachineId?: string;
}

export interface BrainImageSaveFile {
  version: 1;
  status: "running" | "completed" | "failed";
  phase?:
    | "starting"
    | "uploading-script"
    | "exporting-rootfs"
    | "downloading-rootfs"
    | "preparing-push"
    | "pushing-image"
    | "verifying"
    | "completed"
    | "failed";
  message?: string;
  lastOutput?: string;
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

function isBrainSavedImage(value: unknown): value is BrainSavedImage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.label === undefined || isValidBrainImageLabel(v.label)) &&
    (v.note === undefined || isValidBrainImageNote(v.note))
  );
}

function isValidBrainImageLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 80;
}

function isValidBrainImageNote(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= 500;
}

function cleanBrainImageMetadataValue(
  value: string | null | undefined,
  limit: number,
  field: "label" | "note",
): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > limit) {
    throw new Error(`Brain image ${field} is too long`);
  }
  return cleaned;
}

function normalizeBrainSavedImage(image: BrainSavedImage): BrainSavedImage {
  return {
    imageRef: image.imageRef,
    ...(image.label?.trim() ? { label: image.label.trim() } : {}),
    ...(image.note?.trim() ? { note: image.note.trim() } : {}),
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}

function validBrainImageRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter(
    (item): item is string =>
      typeof item === "string" && isValidBrainImageRef(item),
  );
}

function normalizeBrainImageFile(value: unknown): BrainImageFile | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.imageRef === "string" && !isValidBrainImageRef(v.imageRef)) {
    return null;
  }
  const rawImageRef =
    typeof v.imageRef === "string" && isValidBrainImageRef(v.imageRef)
      ? v.imageRef
      : undefined;
  const validBase =
    v.version === 1 &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string";
  if (!validBase) return null;
  const createdAt = v.createdAt as string;
  const updatedAt = v.updatedAt as string;

  const images = Array.isArray(v.images)
    ? v.images.filter(isBrainSavedImage)
    : [];
  const merged = rawImageRef
    ? upsertBrainSavedImage(images, {
        imageRef: rawImageRef,
        createdAt,
        updatedAt,
      })
    : sortBrainSavedImages(images);
  const imageRefs = new Set(merged.map((image) => image.imageRef));
  const forgottenImageRefs = validBrainImageRefs(v.forgottenImageRefs).filter(
    (imageRef) => !imageRefs.has(imageRef),
  );
  const forgotten = new Set(forgottenImageRefs);
  const visibleImages = merged.filter(
    (image) => !forgotten.has(image.imageRef),
  );
  return {
    version: 1,
    ...(rawImageRef && !forgotten.has(rawImageRef)
      ? { imageRef: rawImageRef }
      : {}),
    createdAt,
    updatedAt,
    images: sortBrainSavedImages(visibleImages),
    ...(forgottenImageRefs.length > 0 ? { forgottenImageRefs } : {}),
    ...(typeof v.runningImageRef === "string" &&
    isValidBrainImageRef(v.runningImageRef) &&
    !forgotten.has(v.runningImageRef)
      ? { runningImageRef: v.runningImageRef }
      : {}),
    ...(typeof v.runningAt === "string" ? { runningAt: v.runningAt } : {}),
    ...(typeof v.runningApp === "string" ? { runningApp: v.runningApp } : {}),
    ...(typeof v.runningMachineId === "string"
      ? { runningMachineId: v.runningMachineId }
      : {}),
  };
}

function sortBrainSavedImages(images: BrainSavedImage[]): BrainSavedImage[] {
  return [...images]
    .map(normalizeBrainSavedImage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function upsertBrainSavedImage(
  images: BrainSavedImage[],
  image: BrainSavedImage,
): BrainSavedImage[] {
  const existing = images.filter((item) => item.imageRef !== image.imageRef);
  return sortBrainSavedImages([image, ...existing]);
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
    (v.phase === undefined ||
      v.phase === "starting" ||
      v.phase === "uploading-script" ||
      v.phase === "exporting-rootfs" ||
      v.phase === "downloading-rootfs" ||
      v.phase === "preparing-push" ||
      v.phase === "pushing-image" ||
      v.phase === "verifying" ||
      v.phase === "completed" ||
      v.phase === "failed") &&
    (v.message === undefined ||
      (typeof v.message === "string" && v.message.length <= 500)) &&
    (v.lastOutput === undefined ||
      (typeof v.lastOutput === "string" && v.lastOutput.length <= 2000)) &&
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
  options: { bypassCache?: boolean } = {},
): Promise<BrainImageFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = imageFilePath(login);
  const key = cacheKey("image", login);

  if (options.bypassCache) cache.delete(key);
  const cached = options.bypassCache
    ? null
    : getCache<BrainImageFile | null>(key);
  const octokit = getOctokit();

  try {
    const file = await readStateText(octokit, owner, repo, path, {
      scope: "root",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const parsed: unknown = JSON.parse(file.content);
      const normalized = normalizeBrainImageFile(parsed);
      if (!normalized) {
        setCache(key, null, file.etag);
        return null;
      }
      setCache(key, normalized, file.etag);
      return normalized;
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
  const normalizedFile = normalizeBrainImageFile(file);
  if (!normalizedFile) {
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

  const content = JSON.stringify(normalizedFile, null, 2);
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

export async function selectBrainImage(
  login: string,
  token: string,
  imageRef: string,
): Promise<BrainImageFile> {
  if (!isValidBrainImageRef(imageRef)) {
    throw new Error("Invalid Brain image ref");
  }
  const current = await readBrainImage(login, token);
  if (!current) {
    throw new Error("No Brain images saved");
  }
  let selected = current.images.find((image) => image.imageRef === imageRef);
  if (!selected) {
    const fresh = await readBrainImage(login, token, { bypassCache: true });
    if (!fresh) {
      throw new Error("No Brain images saved");
    }
    current.images = fresh.images;
    current.imageRef = fresh.imageRef;
    current.updatedAt = fresh.updatedAt;
    current.forgottenImageRefs = fresh.forgottenImageRefs;
    current.runningImageRef = fresh.runningImageRef;
    current.runningAt = fresh.runningAt;
    current.runningApp = fresh.runningApp;
    current.runningMachineId = fresh.runningMachineId;
    selected = current.images.find((image) => image.imageRef === imageRef);
  }
  if (!selected) {
    throw new Error("Brain image is not saved");
  }
  const now = new Date().toISOString();
  const updated: BrainImageFile = {
    version: 1,
    imageRef,
    createdAt: current.createdAt,
    updatedAt: now,
    images: upsertBrainSavedImage(current.images, {
      ...selected,
      updatedAt: now,
    }),
    ...(current.forgottenImageRefs?.filter((ref) => ref !== imageRef).length
      ? {
          forgottenImageRefs: current.forgottenImageRefs.filter(
            (ref) => ref !== imageRef,
          ),
        }
      : {}),
    ...(current.runningImageRef
      ? { runningImageRef: current.runningImageRef }
      : {}),
    ...(current.runningAt ? { runningAt: current.runningAt } : {}),
    ...(current.runningApp ? { runningApp: current.runningApp } : {}),
    ...(current.runningMachineId
      ? { runningMachineId: current.runningMachineId }
      : {}),
  };
  await writeBrainImage(login, token, updated);
  return updated;
}

export async function updateBrainImageMetadata(
  login: string,
  token: string,
  input: {
    imageRef: string;
    label?: string | null;
    note?: string | null;
  },
): Promise<BrainImageFile> {
  if (!isValidBrainImageRef(input.imageRef)) {
    throw new Error("Invalid Brain image ref");
  }
  const current = await readBrainImage(login, token);
  if (!current) {
    throw new Error("No Brain images saved");
  }
  let selected = current.images.find(
    (image) => image.imageRef === input.imageRef,
  );
  if (!selected) {
    const fresh = await readBrainImage(login, token, { bypassCache: true });
    if (!fresh) {
      throw new Error("No Brain images saved");
    }
    current.images = fresh.images;
    current.imageRef = fresh.imageRef;
    current.updatedAt = fresh.updatedAt;
    current.forgottenImageRefs = fresh.forgottenImageRefs;
    current.runningImageRef = fresh.runningImageRef;
    current.runningAt = fresh.runningAt;
    current.runningApp = fresh.runningApp;
    current.runningMachineId = fresh.runningMachineId;
    selected = current.images.find((image) => image.imageRef === input.imageRef);
  }
  if (!selected) {
    throw new Error("Brain image is not saved");
  }

  const now = new Date().toISOString();
  const nextImage: BrainSavedImage = {
    ...selected,
    ...(Object.hasOwn(input, "label")
      ? {
          label: cleanBrainImageMetadataValue(input.label, 80, "label"),
        }
      : {}),
    ...(Object.hasOwn(input, "note")
      ? {
          note: cleanBrainImageMetadataValue(input.note, 500, "note"),
        }
      : {}),
    updatedAt: now,
  };
  const updated: BrainImageFile = {
    version: 1,
    ...(current.imageRef ? { imageRef: current.imageRef } : {}),
    createdAt: current.createdAt,
    updatedAt: now,
    images: upsertBrainSavedImage(current.images, nextImage),
    ...(current.forgottenImageRefs?.length
      ? { forgottenImageRefs: current.forgottenImageRefs }
      : {}),
    ...(current.runningImageRef
      ? { runningImageRef: current.runningImageRef }
      : {}),
    ...(current.runningAt ? { runningAt: current.runningAt } : {}),
    ...(current.runningApp ? { runningApp: current.runningApp } : {}),
    ...(current.runningMachineId
      ? { runningMachineId: current.runningMachineId }
      : {}),
  };
  await writeBrainImage(login, token, updated);
  return updated;
}

export async function markBrainImageRunning(
  login: string,
  token: string,
  input: {
    imageRef: string;
    app: string;
    machineId: string;
    runningAt?: string;
  },
): Promise<BrainImageFile> {
  if (!isValidBrainImageRef(input.imageRef)) {
    throw new Error("Invalid Brain image ref");
  }
  const current = await readBrainImage(login, token);
  if (!current) {
    throw new Error("No Brain images saved");
  }
  let selected = current.images.find(
    (image) => image.imageRef === input.imageRef,
  );
  if (!selected) {
    const fresh = await readBrainImage(login, token, { bypassCache: true });
    if (!fresh) {
      throw new Error("No Brain images saved");
    }
    current.images = fresh.images;
    current.imageRef = fresh.imageRef;
    current.updatedAt = fresh.updatedAt;
    current.forgottenImageRefs = fresh.forgottenImageRefs;
    current.runningImageRef = fresh.runningImageRef;
    current.runningAt = fresh.runningAt;
    current.runningApp = fresh.runningApp;
    current.runningMachineId = fresh.runningMachineId;
    selected = current.images.find((image) => image.imageRef === input.imageRef);
  }
  if (!selected) {
    throw new Error("Brain image is not saved");
  }
  const runningAt = input.runningAt ?? new Date().toISOString();
  const forgottenImageRefs = current.forgottenImageRefs?.filter(
    (ref) => ref !== input.imageRef,
  );
  const updated: BrainImageFile = {
    version: 1,
    imageRef: input.imageRef,
    createdAt: current.createdAt,
    updatedAt: runningAt,
    images: upsertBrainSavedImage(current.images, {
      ...selected,
      updatedAt: runningAt,
    }),
    ...(forgottenImageRefs?.length ? { forgottenImageRefs } : {}),
    runningImageRef: input.imageRef,
    runningAt,
    runningApp: input.app,
    runningMachineId: input.machineId,
  };
  await writeBrainImage(login, token, updated);
  return updated;
}

export async function deleteBrainImage(
  login: string,
  token: string,
  imageRef: string,
): Promise<BrainImageFile | null> {
  if (!isValidBrainImageRef(imageRef)) {
    throw new Error("Invalid Brain image ref");
  }
  const current = await readBrainImage(login, token);
  const now = new Date().toISOString();
  if (!current) {
    const updated: BrainImageFile = {
      version: 1,
      createdAt: now,
      updatedAt: now,
      images: [],
      forgottenImageRefs: [imageRef],
    };
    await writeBrainImage(login, token, updated);
    return updated;
  }
  const remaining = current.images.filter(
    (image) => image.imageRef !== imageRef,
  );
  const forgottenImageRefs = [
    ...(current.forgottenImageRefs ?? []).filter((ref) => ref !== imageRef),
    imageRef,
  ];
  const nextImageRef =
    current.imageRef === imageRef ? remaining[0]?.imageRef : current.imageRef;
  const updated: BrainImageFile = {
    version: 1,
    ...(nextImageRef ? { imageRef: nextImageRef } : {}),
    createdAt: current.createdAt,
    updatedAt: now,
    images: remaining,
    forgottenImageRefs,
    ...(current.runningImageRef && current.runningImageRef !== imageRef
      ? { runningImageRef: current.runningImageRef }
      : {}),
    ...(current.runningImageRef && current.runningImageRef !== imageRef
      ? { runningAt: current.runningAt }
      : {}),
    ...(current.runningImageRef && current.runningImageRef !== imageRef
      ? { runningApp: current.runningApp }
      : {}),
    ...(current.runningImageRef && current.runningImageRef !== imageRef
      ? { runningMachineId: current.runningMachineId }
      : {}),
  };
  await writeBrainImage(login, token, updated);
  return updated;
}

export async function clearBrainImage(
  login: string,
  _token: string,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = imageFilePath(login);
  const key = cacheKey("image", login);

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
        message: `feat(brain): clear brain image for ${login}`,
        sha: current.sha,
        scope: "root",
      });
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return;
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
