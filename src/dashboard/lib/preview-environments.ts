/**
 * @fileType module
 * @domain preview
 * @pattern repo-config
 * @ai-summary Named preview environments (Production / Staging / Dev …) — a
 *   label + base-URL list stored per-repo in `.kody/dashboard.json`. Generalises
 *   the legacy single `defaultPreviewUrl`: when no explicit list exists yet we
 *   migrate that one value into a "Default" environment so nothing is lost.
 *   Pure helpers (no React, no storage, no fetch) so the API route and the UI
 *   share one source of truth. A preview ENVIRONMENT is a base URL; a preview
 *   VIEW (see preview-views.ts) is a path under it — different axes.
 */

export interface PreviewEnvironment {
  /** Stable id for React keys + selection state. */
  id: string;
  /** Display label (Production, Staging, Dev, …). Kept short for the toolbar. */
  label: string;
  /** Base URL of the environment. Views (Web/Admin) are paths under this. */
  url: string;
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
   * Set for static resources stored in the consumer repo under
   * `.kody/views/<id>`. These are served by dashboard API with a short-lived
   * ticket instead of Fly.
   */
  repoViewPath?: string;
}

export interface PreviewUploadContext {
  name: string;
  mimeType?: string;
  size?: number;
  title?: string;
  outline?: string;
  textPreview?: string;
}

const ID_RAND_LEN = 4;
const MAX_LABEL = 48;

/** Uploaded static previews live this long before auto-expiry (7 days). */
export const STATIC_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const rand = Math.random()
    .toString(36)
    .slice(2, 2 + ID_RAND_LEN);
  return `${slug || "env"}-${rand}`;
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
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter(
        (e): e is PreviewEnvironment =>
          !!e &&
          typeof e.id === "string" &&
          typeof e.label === "string" &&
          typeof e.url === "string",
      )
      .map((e) => ({ ...e, url: normalizeEnvUrl(e.url) ?? e.url }));
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
): PreviewEnvironment[] {
  const cleanLabel = label.trim().slice(0, MAX_LABEL);
  const cleanUrl = normalizeEnvUrl(url);
  const cleanRepoPath = repoViewPath.trim();
  if (
    !cleanLabel ||
    !cleanUrl ||
    !/^\.kody\/views\/[a-z0-9][a-z0-9-]{0,63}$/.test(cleanRepoPath)
  ) {
    return list;
  }
  return [
    ...list,
    {
      id: makeEnvId(cleanLabel),
      label: cleanLabel,
      url: cleanUrl,
      repoViewPath: cleanRepoPath,
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

/** Remove an environment by id. Returns the next list (immutable). */
export function removeEnvironment(
  list: PreviewEnvironment[],
  id: string,
): PreviewEnvironment[] {
  return list.filter((e) => e.id !== id);
}
