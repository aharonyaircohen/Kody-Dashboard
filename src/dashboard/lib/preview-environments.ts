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
}

const ID_RAND_LEN = 4;
const MAX_LABEL = 48;

/** Slug + short random suffix so labels can repeat without id collisions. */
export function makeEnvId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const rand = Math.random().toString(36).slice(2, 2 + ID_RAND_LEN);
  return `${slug || "env"}-${rand}`;
}

/** Trim + validate a base URL. Returns null when it isn't a usable http(s) URL. */
export function normalizeEnvUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
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
      { id: "default", label: "Default", url: normalizeEnvUrl(legacy) ?? legacy },
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
  return [...list, { id: makeEnvId(cleanLabel), label: cleanLabel, url: cleanUrl }];
}

/**
 * Append an uploaded-file environment, tagged with its `staticId` so removal
 * can also destroy the Fly preview. Same validation as `addEnvironment`.
 */
export function addUploadedEnvironment(
  list: PreviewEnvironment[],
  label: string,
  url: string,
  staticId: string,
): PreviewEnvironment[] {
  const cleanLabel = label.trim().slice(0, MAX_LABEL);
  const cleanUrl = normalizeEnvUrl(url);
  if (!cleanLabel || !cleanUrl || !staticId) return list;
  return [
    ...list,
    { id: makeEnvId(cleanLabel), label: cleanLabel, url: cleanUrl, staticId },
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
    const url = patch.url !== undefined ? normalizeEnvUrl(patch.url) ?? e.url : e.url;
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
