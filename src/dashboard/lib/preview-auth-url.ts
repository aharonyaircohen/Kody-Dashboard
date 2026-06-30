/**
 * @fileType utility
 * @domain preview
 * @pattern preview-auth-url
 * @ai-summary Client-safe helpers for keeping protected Fly preview tickets
 *   out of visible UI while preserving them as the iframe reload source.
 */

const PREVIEW_TICKET_PARAM = "kp";
export const VERCEL_PROTECTION_BYPASS_PARAM = "x-vercel-protection-bypass";
export const VERCEL_SET_BYPASS_COOKIE_PARAM = "x-vercel-set-bypass-cookie";

function parseUrl(url: string, baseUrl?: string): URL | null {
  try {
    return new URL(url, baseUrl);
  } catch {
    return null;
  }
}

function isFlyPreviewUrl(url: URL): boolean {
  return url.hostname.endsWith(".fly.dev");
}

export function stripPreviewAuthParams(
  url: string | null | undefined,
  baseUrl?: string,
): string | null {
  if (!url) return null;
  const parsed = parseUrl(url, baseUrl);
  if (!parsed) return url;

  if (isFlyPreviewUrl(parsed)) parsed.searchParams.delete(PREVIEW_TICKET_PARAM);
  parsed.searchParams.delete(VERCEL_PROTECTION_BYPASS_PARAM);
  parsed.searchParams.delete(VERCEL_SET_BYPASS_COOKIE_PARAM);
  return parsed.toString();
}

export function hasPreviewAuthParams(
  url: string | null | undefined,
  baseUrl?: string,
): boolean {
  if (!url) return false;
  const parsed = parseUrl(url, baseUrl);
  if (!parsed || !isFlyPreviewUrl(parsed)) return false;
  return parsed.searchParams.has(PREVIEW_TICKET_PARAM);
}

export function carryPreviewAuthParams(
  authSourceUrl: string | null | undefined,
  targetUrl: string | null | undefined,
  baseUrl?: string,
): string | null {
  if (!targetUrl) return null;
  const target = parseUrl(targetUrl, baseUrl);
  if (!target) return targetUrl;

  const source = authSourceUrl ? parseUrl(authSourceUrl, baseUrl) : null;
  if (!source || source.origin !== target.origin) return target.toString();
  if (!isFlyPreviewUrl(source) || !isFlyPreviewUrl(target)) {
    return target.toString();
  }

  const ticket = source.searchParams.get(PREVIEW_TICKET_PARAM);
  if (ticket && !target.searchParams.has(PREVIEW_TICKET_PARAM)) {
    target.searchParams.set(PREVIEW_TICKET_PARAM, ticket);
  }
  return target.toString();
}

export function rebasePreviewAuthUrl(
  currentUrl: string | null | undefined,
  freshPreviewUrl: string | null | undefined,
  baseUrl?: string,
): string | null {
  if (!freshPreviewUrl) return null;
  const fresh = parseUrl(freshPreviewUrl, baseUrl);
  if (!fresh) return freshPreviewUrl;

  const current = currentUrl ? parseUrl(currentUrl, baseUrl) : null;
  if (!current || current.origin !== fresh.origin) return fresh.toString();
  if (!isFlyPreviewUrl(current) || !isFlyPreviewUrl(fresh)) {
    return null;
  }

  const ticket = fresh.searchParams.get(PREVIEW_TICKET_PARAM);
  if (!ticket) return null;

  const next = new URL(fresh.toString());
  next.pathname = current.pathname;
  next.search = current.search;
  next.hash = current.hash;
  next.searchParams.set(PREVIEW_TICKET_PARAM, ticket);
  return next.toString();
}
