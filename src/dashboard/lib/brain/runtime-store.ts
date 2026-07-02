/**
 * @fileType service
 * @domain brain
 * @pattern brain-runtime-store
 *
 * @ai-summary Durable per-user Brain runtime state, intentionally
 *   separate from the saved image catalog. Three pieces on one record:
 *   `desiredImageRef` (what the user picked), `running` (the Fly machine
 *   the terminal may connect to), and `operation` (the in-flight
 *   `apply-image` job — its `id` is what polling clients key on). Trap:
 *   the `beginBrainRuntimeApply` write is what makes the operation
 *   observable to the UI — without it the apply job is invisible (the
 *   machine is being created server-side, but the UI's "apply running"
 *   spinner never starts). Always call `begin*` before kicking off
 *   `provisionBrain`, and call `complete*`/`fail*` in the matching
 *   finally/catch. Writes here are the source of truth for the operation
 *   record — the in-flight state file is what the Runner page polls.
 */
import "server-only";

import { getOctokit, getOwner, getRepo } from "../github-client";
import { readStateText, writeStateText } from "../state-repo";
import { isValidBrainImageRef } from "./store";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  data: BrainRuntimeStateFile | null;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();

function runtimeFilePath(login: string): string {
  return `users/${login.toLowerCase()}/data/brain-runtime.json`;
}

function cacheKey(login: string): string {
  return `brain-runtime:${login.toLowerCase()}`;
}

function getCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(
  key: string,
  data: BrainRuntimeStateFile | null,
  etag?: string,
): void {
  cache.set(key, { data, etag, expires: Date.now() + CACHE_TTL_MS });
}

export function _resetBrainRuntimeCache(): void {
  cache.clear();
}

export interface BrainRuntimeRunning {
  imageRef: string;
  app: string;
  machineId: string;
  orgSlug: string;
  url?: string;
  appliedAt: string;
}

export interface BrainRuntimeOperation {
  id: string;
  type: "apply-image";
  status: "running" | "completed" | "failed";
  imageRef: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

export interface BrainRuntimeStateFile {
  version: 1;
  desiredImageRef?: string;
  running?: BrainRuntimeRunning;
  operation?: BrainRuntimeOperation;
  updatedAt: string;
}

function isRuntimeRunning(value: unknown): value is BrainRuntimeRunning {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.app === "string" &&
    v.app.length > 0 &&
    typeof v.machineId === "string" &&
    v.machineId.length > 0 &&
    typeof v.orgSlug === "string" &&
    v.orgSlug.length > 0 &&
    (v.url === undefined || typeof v.url === "string") &&
    typeof v.appliedAt === "string"
  );
}

function isRuntimeOperation(value: unknown): value is BrainRuntimeOperation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    v.type === "apply-image" &&
    (v.status === "running" ||
      v.status === "completed" ||
      v.status === "failed") &&
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.startedAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.error === undefined || typeof v.error === "string")
  );
}

function normalizeRuntimeState(value: unknown): BrainRuntimeStateFile | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.updatedAt !== "string") return null;
  if (
    typeof v.desiredImageRef === "string" &&
    !isValidBrainImageRef(v.desiredImageRef)
  ) {
    return null;
  }
  const desiredImageRef =
    typeof v.desiredImageRef === "string" ? v.desiredImageRef : undefined;
  const running = isRuntimeRunning(v.running) ? v.running : undefined;
  const operation = isRuntimeOperation(v.operation) ? v.operation : undefined;
  return {
    version: 1,
    ...(desiredImageRef ? { desiredImageRef } : {}),
    ...(running ? { running } : {}),
    ...(operation ? { operation } : {}),
    updatedAt: v.updatedAt,
  };
}

export async function readBrainRuntimeState(
  login: string,
  _token: string,
): Promise<BrainRuntimeStateFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = runtimeFilePath(login);
  const key = cacheKey(login);
  const cached = getCache(key);
  const octokit = getOctokit();

  try {
    const file = await readStateText(octokit, owner, repo, path, {
      scope: "root",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (!file) {
      setCache(key, null);
      return null;
    }
    const parsed = normalizeRuntimeState(JSON.parse(file.content));
    setCache(key, parsed, file.etag);
    return parsed;
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

export async function writeBrainRuntimeState(
  login: string,
  _token: string,
  file: BrainRuntimeStateFile,
): Promise<void> {
  const normalized = normalizeRuntimeState(file);
  if (!normalized) {
    throw new Error("Invalid Brain runtime state");
  }
  const owner = getOwner();
  const repo = getRepo();
  const path = runtimeFilePath(login);
  const key = cacheKey(login);
  cache.delete(key);

  let sha: string | undefined;
  try {
    const octokit = getOctokit();
    const current = await readStateText(octokit, owner, repo, path, {
      scope: "root",
    });
    sha = current?.sha;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status !== 404) throw error;
  }

  const message = `feat(brain): record brain runtime for ${login}`;
  const content = JSON.stringify(normalized, null, 2);
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
  } catch (error: unknown) {
    if ((error as { status?: number })?.status !== 409) throw error;
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
  }
}
