/**
 * @fileType module
 * @domain preview
 * @pattern repo-scoped-localStorage
 * @ai-summary User-managed list of preview "views" — name + relative path
 *   pairs that appear as buttons above the preview iframe (e.g. Web → /,
 *   Admin → /admin, Storybook → /storybook). Replaces the hardcoded
 *   Web/Admin pair. Stored per-repo in localStorage so each project can
 *   have its own list without sharing across repos.
 */

export interface PreviewView {
  /** Stable id for React keys + selection state. */
  id: string;
  /** Display label on the button (kept short — fits the toolbar). */
  name: string;
  /** Relative path from the preview's base URL. Always starts with "/". */
  path: string;
}

const STORAGE_PREFIX = "kody.previewViews";

/** Built-in defaults so a fresh repo still shows the familiar Web/Admin. */
export const DEFAULT_PREVIEW_VIEWS: PreviewView[] = [
  { id: "web", name: "Web", path: "/" },
  { id: "admin", name: "Admin", path: "/admin" },
];

function storageKey(owner: string, repo: string): string {
  return `${STORAGE_PREFIX}.${owner}/${repo}`;
}

function stripTrailingPathSlash(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const splitIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  const pathname = splitIndex === -1 ? path : path.slice(0, splitIndex);
  const suffix = splitIndex === -1 ? "" : path.slice(splitIndex);

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return `${pathname.slice(0, -1)}${suffix}`;
  }

  return path;
}

function splitViewPath(path: string): {
  pathname: string;
  search: string;
  hash: string;
} {
  const hashIndex = path.indexOf("#");
  const beforeHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");

  if (queryIndex === -1) {
    return { pathname: beforeHash, search: "", hash };
  }

  return {
    pathname: beforeHash.slice(0, queryIndex) || "/",
    search: beforeHash.slice(queryIndex),
    hash,
  };
}

/** Normalize a user-entered path: must start with "/", no trailing slash. */
export function normalizePath(input: string): string {
  let p = (input || "").trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = "/" + p;
  return stripTrailingPathSlash(p);
}

/**
 * Join a preview base URL with a view path. Identical semantics to the
 * legacy hardcoded "/admin" append in VibePage / PreviewModal, but the
 * path is now user-configurable.
 */
export function joinPreviewUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return "";
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const tail = normalizePath(path);
  const tailParts = splitViewPath(tail);
  if (tailParts.pathname === "/" && !tailParts.search && !tailParts.hash) {
    return normalized || baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    if (tailParts.pathname !== "/") {
      const basePath =
        url.pathname.length > 1 && url.pathname.endsWith("/")
          ? url.pathname.slice(0, -1)
          : url.pathname;
      const prefix = basePath === "/" ? "" : basePath;
      url.pathname = `${prefix}${tailParts.pathname}`;
    }

    if (tailParts.search) {
      const viewParams = new URLSearchParams(tailParts.search);
      viewParams.forEach((value, key) => {
        url.searchParams.append(key, value);
      });
    }

    if (tailParts.hash) {
      url.hash = tailParts.hash;
    }

    return url.toString();
  } catch {
    // Preserve the historical string append behavior for non-absolute bases.
  }

  return `${normalized}${tail}`;
}

/** Read the stored list (or seed with defaults if none yet). SSR-safe. */
export function readPreviewViews(owner: string, repo: string): PreviewView[] {
  if (typeof window === "undefined") return DEFAULT_PREVIEW_VIEWS;
  try {
    const raw = window.localStorage.getItem(storageKey(owner, repo));
    if (!raw) return DEFAULT_PREVIEW_VIEWS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PREVIEW_VIEWS;
    const safe = parsed
      .filter(
        (v): v is PreviewView =>
          v &&
          typeof v === "object" &&
          typeof v.id === "string" &&
          typeof v.name === "string" &&
          typeof v.path === "string",
      )
      .map((v) => ({ ...v, path: normalizePath(v.path) }));
    return safe.length > 0 ? safe : DEFAULT_PREVIEW_VIEWS;
  } catch {
    return DEFAULT_PREVIEW_VIEWS;
  }
}

/** Write the list back to storage. No-ops in SSR / private mode. */
export function writePreviewViews(
  owner: string,
  repo: string,
  views: PreviewView[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(owner, repo), JSON.stringify(views));
  } catch {
    /* quota / private mode — silently drop */
  }
}

/** Append a new view. Returns the next list (immutable). */
export function addPreviewView(
  views: PreviewView[],
  name: string,
  path: string,
): PreviewView[] {
  const trimmedName = name.trim().slice(0, 32);
  if (!trimmedName) return views;
  const id = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return [...views, { id, name: trimmedName, path: normalizePath(path) }];
}

/** Remove a view by id. Default views CAN be removed — user is in control. */
export function removePreviewView(
  views: PreviewView[],
  id: string,
): PreviewView[] {
  return views.filter((v) => v.id !== id);
}
