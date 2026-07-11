import { PACKAGE_ADMIN_PAGE_META } from "@kody-ade/kody-chat/admin-pages-meta";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface ParsedRepoScopedPath extends RepoRef {
  restSegments: string[];
  restPath: string;
}

export const REPO_ROUTE_PREFIX = "/repo";

interface RepoRouteAuthLike extends RepoRef {
  currentRepoIndex: number;
  repos: Array<Pick<RepoRef, "owner" | "repo">>;
}

export type RepoRouteAuthSync =
  | { status: "none" }
  | { status: "current" }
  | { status: "switch"; index: number }
  | ({ status: "missing" } & RepoRef);

const REPO_OWNED_LEGACY_PREFIXES = [
  "/activity",
  "/agent-goals",
  "/agent-loops",
  "/agents",
  "/brands",
  ...PACKAGE_ADMIN_PAGE_META.map((page) => page.href),
  "/capabilities",
  "/changelog",
  "/chat",
  "/commands",
  "/company",
  "/company-intents",
  "/config",
  "/content/entries",
  "/content/models",
  "/content/settings",
  "/context",
  "/docs",
  "/files",
  "/fly",
  "/instructions",
  "/jobs",
  "/memory",
  "/messages",
  "/models",
  "/notifications",
  "/preview",
  "/reports",
  "/runner",
  "/secrets",
  "/store-catalog",
  "/tasks",
  "/todos",
  "/variables",
  "/vibe",
  "/workflows",
] as const;

function cleanSegment(value: string | number): string {
  return String(value).trim();
}

function encodeSegment(value: string | number): string {
  return encodeURIComponent(cleanSegment(value));
}

function splitChildPath(path?: string | null): string[] {
  if (!path) return [];
  const marker = path.search(/[?#]/);
  const cleanPath = marker === -1 ? path : path.slice(0, marker);
  return cleanPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function joinPath(...segments: Array<string | number | null | undefined>) {
  const encoded = segments
    .filter(
      (segment): segment is string | number =>
        segment !== null && segment !== undefined,
    )
    .map(encodeSegment)
    .filter(Boolean);
  return `/${encoded.join("/")}`;
}

export function repoBasePath(ref: RepoRef): string {
  return `${REPO_ROUTE_PREFIX}${joinPath(ref.owner, ref.repo)}`;
}

export function repoScopedPath(
  ref: RepoRef,
  childPath?: string | null,
): string {
  const child = splitChildPath(childPath);
  if (child.length === 0) return repoBasePath(ref);
  return `${repoBasePath(ref)}${joinPath(...child)}`;
}

function repoSelectionPath(
  ref: RepoRef,
  basePath: string,
  ...segments: Array<string | number | null | undefined>
): string {
  return repoScopedPath(
    ref,
    [basePath, ...segments.map((segment) => segment?.toString() ?? "")]
      .flatMap((part) => splitChildPath(part))
      .join("/"),
  );
}

export const routes = {
  home: () => "/",
  orgHome: () => "/org",
  org: (org: string) => joinPath("org", org),
  globalSettings: () => "/settings",

  repoHome: (ref: RepoRef) => repoBasePath(ref),
  repoDashboard: (ref: RepoRef) => repoBasePath(ref),
  repoTasks: (ref: RepoRef) => repoSelectionPath(ref, "tasks"),
  repoTask: (ref: RepoRef, issueNumber: number) =>
    repoSelectionPath(ref, String(issueNumber)),
  repoTaskComments: (ref: RepoRef, issueNumber: number) =>
    repoSelectionPath(ref, String(issueNumber), "comments"),
  repoTaskPreview: (
    ref: RepoRef,
    issueNumber: number,
    tab?: "changes" | "comments" | "docs",
  ) => repoSelectionPath(ref, String(issueNumber), "preview", tab),
  repoFiles: (ref: RepoRef, path?: string | null) =>
    repoSelectionPath(ref, "files", path),
  repoDocs: (ref: RepoRef, path?: string | null) =>
    repoSelectionPath(ref, "docs", path),
  repoReports: (ref: RepoRef, slug?: string | null) =>
    repoSelectionPath(ref, "reports", slug),
  repoTodos: (ref: RepoRef) => repoSelectionPath(ref, "todos"),
  repoTodoList: (ref: RepoRef, slug: string) =>
    repoSelectionPath(ref, "todos", slug),
  repoTodoItem: (ref: RepoRef, slug: string, itemId: string) =>
    repoSelectionPath(ref, "todos", slug, itemId),
  repoSecrets: (ref: RepoRef) => repoSelectionPath(ref, "secrets"),
  repoConfig: (ref: RepoRef) => repoSelectionPath(ref, "config"),
  repoContext: (ref: RepoRef, slug?: string | null) =>
    repoSelectionPath(ref, "context", slug),
  repoMemory: (ref: RepoRef, id?: string | null) =>
    repoSelectionPath(ref, "memory", id),
  repoContentEntries: (
    ref: RepoRef,
    collection?: string | null,
    id?: string | null,
  ) => repoSelectionPath(ref, "content/entries", collection, id),
  repoContentModels: (ref: RepoRef) => repoSelectionPath(ref, "content/models"),
  repoContentSettings: (ref: RepoRef) =>
    repoSelectionPath(ref, "content/settings"),
};

export function parseRepoScopedPath(
  pathname: string,
): ParsedRepoScopedPath | null {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== REPO_ROUTE_PREFIX.slice(1)) return null;
  if (!segments[1] || !segments[2]) return null;
  const restSegments = segments.slice(3);
  return {
    owner: segments[1],
    repo: segments[2],
    restSegments,
    restPath: restSegments.length ? `/${restSegments.join("/")}` : "/",
  };
}

function stripSearchAndHash(pathname: string): string {
  const marker = pathname.search(/[?#]/);
  return marker === -1 ? pathname : pathname.slice(0, marker);
}

function splitHref(href: string): { path: string; suffix: string } {
  const marker = href.search(/[?#]/);
  if (marker === -1) return { path: href, suffix: "" };
  return { path: href.slice(0, marker), suffix: href.slice(marker) };
}

function startsWithPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isLegacyTaskPath(pathname: string): boolean {
  return /^\/\d+(?:\/|$)/.test(pathname);
}

export function isLegacyRepoOwnedPath(pathname: string): boolean {
  const cleanPath = stripSearchAndHash(pathname) || "/";
  if (cleanPath === "/") return true;
  if (parseRepoScopedPath(cleanPath)) return false;
  if (cleanPath === REPO_ROUTE_PREFIX) return false;
  if (isLegacyTaskPath(cleanPath)) return true;
  return REPO_OWNED_LEGACY_PREFIXES.some((prefix) =>
    startsWithPath(cleanPath, prefix),
  );
}

export function legacyRepoRedirectPath(
  ref: RepoRef,
  pathname: string,
): string | null {
  const cleanPath = stripSearchAndHash(pathname) || "/";
  if (!isLegacyRepoOwnedPath(cleanPath)) return null;
  if (parseRepoScopedPath(cleanPath)) return null;
  if (cleanPath === "/") return routes.repoHome(ref);
  return repoScopedPath(ref, cleanPath);
}

export function repoScopedHref(ref: RepoRef, href: string): string {
  if (!href.startsWith("/")) return href;
  const { path, suffix } = splitHref(href);
  if (parseRepoScopedPath(path)) return href;
  if (!isLegacyRepoOwnedPath(path)) return href;
  const scoped =
    path === "/" ? routes.repoHome(ref) : repoScopedPath(ref, path);
  return `${scoped}${suffix}`;
}

export function repoSwitchRedirectPath(
  ref: RepoRef,
  currentHref: string,
): string {
  const href = currentHref || "/";
  if (!href.startsWith("/")) return routes.repoHome(ref);
  const { path, suffix } = splitHref(href);
  const parsed = parseRepoScopedPath(path);
  if (parsed) return `${repoScopedPath(ref, parsed.restPath)}${suffix}`;
  if (isLegacyRepoOwnedPath(path)) return repoScopedHref(ref, href);
  return routes.repoHome(ref);
}

export function repoPathForNavMatching(pathname: string): string {
  const parsed = parseRepoScopedPath(stripSearchAndHash(pathname));
  return parsed?.restPath ?? pathname;
}

function repoRefEquals(a: RepoRef, b: RepoRef): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

export function resolveRepoRouteAuthSync(
  pathname: string,
  auth: RepoRouteAuthLike | null | undefined,
): RepoRouteAuthSync {
  const parsed = parseRepoScopedPath(stripSearchAndHash(pathname));
  if (!parsed || !auth) return { status: "none" };
  const target = { owner: parsed.owner, repo: parsed.repo };
  if (repoRefEquals(auth, target)) return { status: "current" };
  const index = auth.repos.findIndex((repoEntry) =>
    repoRefEquals(repoEntry, target),
  );
  if (index >= 0) return { status: "switch", index };
  return { status: "missing", ...target };
}
