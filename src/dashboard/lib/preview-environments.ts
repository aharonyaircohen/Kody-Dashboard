/**
 * @fileType module
 * @domain preview
 * @pattern repo-config
 * @ai-summary Named preview environments (Production / Staging / Dev …) — a
 *   label + base-URL list stored per-repo in `dashboard.json` in the configured
 *   Kody state repo. Generalises
 *   the legacy single `defaultPreviewUrl`: when no explicit list exists yet we
 *   migrate that one value into a "Default" environment so nothing is lost.
 *   Pure helpers (no React, no storage, no fetch) so the API route and the UI
 *   share one source of truth. A preview ENVIRONMENT is a base URL; a preview
 *   VIEW (see preview-views.ts) is a path under it — different axes.
 */

import { slugifyTitle } from "./slug";

export interface PreviewEnvironment {
  /** Stable id for React keys + selection state. */
  id: string;
  /** Display label (Production, Staging, Dev, …). Kept short for the toolbar. */
  label: string;
  /** Base URL of the environment. Views (Web/Admin) are paths under this. */
  url?: string;
  /**
   * Stable pointer to a Kody Fly branch preview. The signed URL is minted when
   * the workspace opens it, so saved environments never store an expiring token.
   */
  flyBranch?: FlyBranchPreviewRef;
  /**
   * Set only for environments created by uploading a file (served on a Fly
   * static preview, no build). Lets removal also destroy the Fly app — a
   * plain URL environment has no `staticId` and nothing to tear down.
   */
  staticId?: string;
  /**
   * Absolute expiry (ms epoch) for uploaded previews. Past this, the
   * workspace reaps it on load (destroys the Fly app + drops it). Plain URL
   * environments never set this — they don't expire.
   */
  expiresAt?: number;
  /**
   * Small, non-secret summary of the uploaded source file. Stored with uploaded
   * previews so chat can understand the page even when the inspector extension
   * cannot read the iframe yet.
   */
  uploadContext?: PreviewUploadContext;
  /**
   * Set for static resources stored in the state repo under `views/<id>`.
   * These are served by dashboard API with a short-lived
   * ticket instead of Fly.
   */
  repoViewPath?: string;
  /** GitHub URL for the stored entry file behind a repo-backed static view. */
  repoViewSourceUrl?: string;
  /** Entry file path inside `repoViewPath`, usually `index.html`. */
  repoViewEntryPath?: string;
  /** Optional bookmark folder for organizing saved preview environments. */
  folderId?: string;
}

export interface PreviewUploadContext {
  name: string;
  mimeType?: string;
  size?: number;
  title?: string;
  outline?: string;
  textPreview?: string;
}

export interface FlyBranchPreviewRef {
  /** owner/name */
  repo: string;
  branch: string;
}

export interface PreviewEnvironmentFolder {
  /** Stable id for folder grouping. */
  id: string;
  /** Display label shown in the preview environment switcher. */
  label: string;
}

const ID_RAND_LEN = 4;
const MAX_LABEL = 48;
const MAX_FOLDER_LABEL = 40;
const REPO_VIEW_PATH_RE = /^(?:\.kody\/)?views\/([a-z0-9][a-z0-9-]{0,63})$/;
const REPO_REF_RE = /^[^/\s]+\/[^/\s]+$/;

/** Uploaded static previews live this long before auto-expiry (7 days). */
export const STATIC_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function repoViewIdFromPath(path: string | undefined): string | null {
  return REPO_VIEW_PATH_RE.exec(path ?? "")?.[1] ?? null;
}

export function normalizeRepoViewPath(path: string): string | null {
  const id = repoViewIdFromPath(path.trim());
  return id ? `views/${id}` : null;
}

export function normalizeRepoRef(repo: string): string | null {
  const trimmed = repo.trim();
  return REPO_REF_RE.test(trimmed) ? trimmed : null;
}

export function normalizeBranchName(branch: string): string | null {
  const trimmed = branch.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

export function isFlyBranchEnvironment(
  env: PreviewEnvironment | null | undefined,
): env is PreviewEnvironment & { flyBranch: FlyBranchPreviewRef } {
  return Boolean(env?.flyBranch);
}

/** Whole days until expiry (ceil). Negative once expired. */
export function daysUntilExpiry(expiresAt: number, now: number): number {
  return Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
}

/** Uploaded environments whose expiry has passed — the reap set. */
export function expiredUploads(
  list: PreviewEnvironment[],
  now: number,
): PreviewEnvironment[] {
  return list.filter(
    (e) => e.staticId && typeof e.expiresAt === "number" && e.expiresAt <= now,
  );
}

/** Set a new absolute expiry on one environment (immutable). */
export function setEnvExpiry(
  list: PreviewEnvironment[],
  id: string,
  expiresAt: number,
): PreviewEnvironment[] {
  return list.map((e) => (e.id === id ? { ...e, expiresAt } : e));
}

/** Slug + short random suffix so labels can repeat without id collisions. */
export function makeEnvId(label: string): string {
  const slug = slugifyTitle(label, {
    fallback: "env",
    allowUnderscore: false,
  });
  const rand = Math.random()
    .toString(36)
    .slice(2, 2 + ID_RAND_LEN);
  return `${slug || "env"}-${rand}`;
}

export function makeFolderId(label: string): string {
  const slug = slugifyTitle(label, {
    fallback: "folder",
    allowUnderscore: false,
  });
  const rand = Math.random()
    .toString(36)
    .slice(2, 2 + ID_RAND_LEN);
  return `${slug || "folder"}-${rand}`;
}

export function addPreviewFolder(
  folders: PreviewEnvironmentFolder[],
  label: string,
): PreviewEnvironmentFolder[] {
  const cleanLabel = label.trim().slice(0, MAX_FOLDER_LABEL);
  if (!cleanLabel) return folders;
  return [...folders, { id: makeFolderId(cleanLabel), label: cleanLabel }];
}

export function removePreviewFolder(
  folders: PreviewEnvironmentFolder[],
  id: string,
): PreviewEnvironmentFolder[] {
  return folders.filter((folder) => folder.id !== id);
}

export function updatePreviewFolder(
  folders: PreviewEnvironmentFolder[],
  id: string,
  label: string,
): PreviewEnvironmentFolder[] {
  const cleanLabel = label.trim().slice(0, MAX_FOLDER_LABEL);
  if (!cleanLabel) return folders;
  return folders.map((folder) =>
    folder.id === id ? { ...folder, label: cleanLabel } : folder,
  );
}

export function moveEnvironmentToFolder(
  list: PreviewEnvironment[],
  id: string,
  folderId: string | null,
): PreviewEnvironment[] {
  return list.map((env) => {
    if (env.id !== id) return env;
    const next = { ...env };
    if (folderId) next.folderId = folderId;
    else delete next.folderId;
    return next;
  });
}

export function reorderEnvironment(
  list: PreviewEnvironment[],
  draggedId: string,
  beforeId: string | null,
  folderId: string | null,
): PreviewEnvironment[] {
  const dragged = list.find((env) => env.id === draggedId);
  if (!dragged) return list;

  const withoutDragged = list.filter((env) => env.id !== draggedId);
  const nextDragged = { ...dragged };
  if (folderId) nextDragged.folderId = folderId;
  else delete nextDragged.folderId;

  if (!beforeId || beforeId === draggedId) {
    return [...withoutDragged, nextDragged];
  }

  const beforeIndex = withoutDragged.findIndex((env) => env.id === beforeId);
  if (beforeIndex === -1) return [...withoutDragged, nextDragged];

  return [
    ...withoutDragged.slice(0, beforeIndex),
    nextDragged,
    ...withoutDragged.slice(beforeIndex),
  ];
}

export function resolvePreviewFolders(
  folders: unknown,
): PreviewEnvironmentFolder[] {
  if (!Array.isArray(folders)) return [];
  return folders
    .filter(
      (folder): folder is PreviewEnvironmentFolder =>
        !!folder &&
        typeof folder === "object" &&
        typeof folder.id === "string" &&
        typeof folder.label === "string",
    )
    .map((folder) => ({
      id: folder.id.slice(0, 64),
      label: folder.label.trim().slice(0, MAX_FOLDER_LABEL),
    }))
    .filter((folder) => folder.id && folder.label);
}

/** Trim + validate a base URL. Returns null when it isn't a usable http(s) URL. */
export function normalizeEnvUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  if (
    /^\/api\/kody\/views\/(?!_t\/)[A-Za-z0-9][A-Za-z0-9-]{0,63}(?:\/[^\s?#]*)?(?:\?[^#\s]*)?(?:#[^\s]*)?$/.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Drop a lone trailing slash so joinPreviewUrl composes cleanly.
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  } catch {
    return null;
  }
}

interface LegacyConfigShape {
  namedPreviews?: PreviewEnvironment[];
  defaultPreviewUrl?: string;
}

/**
 * Resolve the environment list from a dashboard config, migrating the legacy
 * single `defaultPreviewUrl` into a one-item list when no explicit list
 * exists. Never mutates the input.
 */
export function resolveEnvironments(
  config: LegacyConfigShape | null | undefined,
): PreviewEnvironment[] {
  const list = config?.namedPreviews;
  if (Array.isArray(list)) {
    return list
      .filter(
        (e): e is PreviewEnvironment =>
          !!e &&
          typeof e.id === "string" &&
          typeof e.label === "string" &&
          (typeof e.url === "string" || Boolean(e.flyBranch)),
      )
      .map((e) => ({
        ...e,
        ...(typeof e.url === "string"
          ? { url: normalizeEnvUrl(e.url) ?? e.url }
          : {}),
      }));
  }
  const legacy = config?.defaultPreviewUrl?.trim();
  if (legacy) {
    return [
      {
        id: "default",
        label: "Default",
        url: normalizeEnvUrl(legacy) ?? legacy,
      },
    ];
  }
  return [];
}

/** Append a Fly branch preview environment. */
export function addBranchPreviewEnvironment(
  list: PreviewEnvironment[],
  repo: string,
  branch: string,
): PreviewEnvironment[] {
  const cleanRepo = normalizeRepoRef(repo);
  const cleanBranch = normalizeBranchName(branch);
  if (!cleanRepo || !cleanBranch) return list;
  return [
    ...list,
    {
      id: makeEnvId(cleanBranch),
      label: cleanBranch.slice(0, MAX_LABEL),
      flyBranch: { repo: cleanRepo, branch: cleanBranch },
    },
  ];
}

/** Append a new environment. Returns the next list (immutable). No-op if invalid. */
export function addEnvironment(
  list: PreviewEnvironment[],
  label: string,
  url: string,
): PreviewEnvironment[] {
  const cleanLabel = label.trim().slice(0, MAX_LABEL);
  const cleanUrl = normalizeEnvUrl(url);
  if (!cleanLabel || !cleanUrl) return list;
  return [
    ...list,
    { id: makeEnvId(cleanLabel), label: cleanLabel, url: cleanUrl },
  ];
}

/**
 * Append an uploaded-file environment, tagged with its `staticId` so removal
 * can also destroy the Fly preview and `expiresAt` so it auto-reaps. Same
 * validation as `addEnvironment`. `expiresAt` is passed in (callers stamp the
 * clock) to keep this pure + testable.
 */
export function addUploadedEnvironment(
  list: PreviewEnvironment[],
  label: string,
  url: string,
  staticId: string,
  expiresAt: number,
  uploadContext?: PreviewUploadContext,
): PreviewEnvironment[] {
  const cleanLabel = label.trim().slice(0, MAX_LABEL);
  const cleanUrl = normalizeEnvUrl(url);
  if (!cleanLabel || !cleanUrl || !staticId) return list;
  return [
    ...list,
    {
      id: makeEnvId(cleanLabel),
      label: cleanLabel,
      url: cleanUrl,
      staticId,
      expiresAt,
      ...(uploadContext ? { uploadContext } : {}),
    },
  ];
}

/** Append a repo-backed static view environment. */
export function addRepoViewEnvironment(
  list: PreviewEnvironment[],
  label: string,
  url: string,
  repoViewPath: string,
  uploadContext?: PreviewUploadContext,
  source?: { sourceUrl?: string | null; entryPath?: string | null },
): PreviewEnvironment[] {
  const cleanLabel = label.trim().slice(0, MAX_LABEL);
  const cleanUrl = normalizeEnvUrl(url);
  const cleanRepoPath = normalizeRepoViewPath(repoViewPath);
  if (!cleanLabel || !cleanUrl || !cleanRepoPath) {
    return list;
  }
  return [
    ...list,
    {
      id: makeEnvId(cleanLabel),
      label: cleanLabel,
      url: cleanUrl,
      repoViewPath: cleanRepoPath,
      ...(source?.sourceUrl ? { repoViewSourceUrl: source.sourceUrl } : {}),
      ...(source?.entryPath ? { repoViewEntryPath: source.entryPath } : {}),
      ...(uploadContext ? { uploadContext } : {}),
    },
  ];
}

/** Patch one environment's label / url. Invalid fields are ignored, not cleared. */
export function updateEnvironment(
  list: PreviewEnvironment[],
  id: string,
  patch: { label?: string; url?: string },
): PreviewEnvironment[] {
  return list.map((e) => {
    if (e.id !== id) return e;
    const label =
      patch.label !== undefined
        ? patch.label.trim().slice(0, MAX_LABEL) || e.label
        : e.label;
    const url =
      patch.url !== undefined ? (normalizeEnvUrl(patch.url) ?? e.url) : e.url;
    return { ...e, label, url };
  });
}

/** Replace one Fly branch environment's branch pointer. */
export function updateBranchPreviewEnvironment(
  list: PreviewEnvironment[],
  id: string,
  repo: string,
  branch: string,
): PreviewEnvironment[] {
  const cleanRepo = normalizeRepoRef(repo);
  const cleanBranch = normalizeBranchName(branch);
  if (!cleanRepo || !cleanBranch) return list;
  return list.map((e) =>
    e.id === id
      ? {
          ...e,
          label: cleanBranch.slice(0, MAX_LABEL),
          flyBranch: { repo: cleanRepo, branch: cleanBranch },
          url: undefined,
        }
      : e,
  );
}

/** Remove an environment by id. Returns the next list (immutable). */
export function removeEnvironment(
  list: PreviewEnvironment[],
  id: string,
): PreviewEnvironment[] {
  return list.filter((e) => e.id !== id);
}
