const HEADER_OWNING_ROUTES = new Set([
  "/tasks",
  "/new",
  "/bug",
  "/report-kody-bug",
]);

function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return "";
  return pathname.replace(/\/+$/, "") || "/";
}

export function routeOwnsAppHeader(pathname: string | null | undefined) {
  const path = normalizePathname(pathname);

  return (
    HEADER_OWNING_ROUTES.has(path) ||
    path === "/vibe" ||
    path.startsWith("/vibe/") ||
    /^\/\d+(?:\/|$)/.test(path)
  );
}
