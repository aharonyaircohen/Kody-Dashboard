/**
 * @fileType utility
 * @domain kody
 * @pattern github-ip-verification
 *
 * Verifies an inbound webhook came from GitHub by checking the source IP
 * against the CIDR ranges GitHub publishes at https://api.github.com/meta.
 *
 * No shared secret needed — TCP+TLS make IP spoofing infeasible over the
 * public internet, so this is sufficient auth for a cache-invalidation
 * endpoint where the worst-case forgery cost is one extra ETag-cheap
 * read against GitHub.
 *
 * The CIDR list is cached in-memory for 24h. Refreshed on miss/stale.
 */

import { logger } from "@dashboard/lib/logger";

const META_URL = "https://api.github.com/meta";
const TTL_MS = 24 * 60 * 60 * 1000;

interface CidrCache {
  cidrs: string[];
  expires: number;
}
// Two caches: webhook ranges (hooks[]) for the /api/webhooks/github route,
// and Actions ranges (actions[]) for /api/kody/events/ingest. Different
// endpoints serve different traffic shapes — keeping them separate avoids
// false positives in either direction.
let webhookCache: CidrCache | null = null;
let actionsCache: CidrCache | null = null;
let inflightHooks: Promise<string[]> | null = null;
let inflightActions: Promise<string[]> | null = null;

// ============ Public API ============

/**
 * Returns true if the given IP address is in one of GitHub's webhook
 * delivery CIDR ranges. Returns false for missing/invalid input or when
 * the meta endpoint can't be reached and we have no cached list.
 */
export async function isFromGitHub(ip: string | null | undefined): Promise<boolean> {
  return matchAgainstField(ip, "hooks");
}

/**
 * Returns true if the given IP belongs to a GitHub-hosted Actions runner.
 * Used by /api/kody/events/ingest to authenticate engine event POSTs without
 * a shared HMAC secret. Same trust model as isFromGitHub — TCP+TLS make
 * spoofing infeasible from the public internet.
 */
export async function isFromGitHubActions(ip: string | null | undefined): Promise<boolean> {
  return matchAgainstField(ip, "actions");
}

async function matchAgainstField(
  ip: string | null | undefined,
  field: "hooks" | "actions",
): Promise<boolean> {
  if (!ip) return false;
  const cleaned = normalizeIp(ip);
  if (!cleaned) return false;
  let cidrs: string[];
  try {
    cidrs = await getCidrs(field);
  } catch (err) {
    logger.warn({ event: "github_ip_meta_fetch_failed", err, field }, "Could not fetch GitHub meta");
    return false;
  }
  return cidrs.some((cidr) => ipInCidr(cleaned, cidr));
}

/**
 * Extracts the originating client IP from request headers. Vercel sets
 * `x-forwarded-for` to a comma-separated chain; the first entry is the
 * client. Falls back to `x-real-ip`.
 */
export function getClientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

// ============ CIDR cache ============

async function getCidrs(field: "hooks" | "actions"): Promise<string[]> {
  const cache = field === "hooks" ? webhookCache : actionsCache;
  if (cache && cache.expires > Date.now()) return cache.cidrs;
  const existing = field === "hooks" ? inflightHooks : inflightActions;
  if (existing) return existing;
  const promise = fetchCidrs(field)
    .then((cidrs) => {
      const fresh = { cidrs, expires: Date.now() + TTL_MS };
      if (field === "hooks") webhookCache = fresh;
      else actionsCache = fresh;
      return cidrs;
    })
    .finally(() => {
      if (field === "hooks") inflightHooks = null;
      else inflightActions = null;
    });
  if (field === "hooks") inflightHooks = promise;
  else inflightActions = promise;
  return promise;
}

async function fetchCidrs(field: "hooks" | "actions"): Promise<string[]> {
  const res = await fetch(META_URL, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`meta ${res.status}`);
  const json = (await res.json()) as { hooks?: string[]; actions?: string[] };
  const value = json[field];
  return Array.isArray(value) ? value : [];
}

// ============ IP matching ============

function normalizeIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip IPv6 zone id (fe80::1%eth0 → fe80::1)
  const noZone = trimmed.split("%")[0];
  // Strip IPv4-mapped IPv6 prefix so 4in6 addresses match v4 CIDRs.
  // (e.g. ::ffff:140.82.115.42 → 140.82.115.42)
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(noZone);
  return m ? m[1] : noZone;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  if (!range || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0) return false;

  const ipIsV4 = ip.includes(".");
  const rangeIsV4 = range.includes(".");
  if (ipIsV4 !== rangeIsV4) return false;

  if (ipIsV4) {
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(range);
    if (a == null || b == null) return false;
    if (bits === 0) return true;
    if (bits > 32) return false;
    const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
    return (a & mask) === (b & mask);
  }

  // IPv6
  const a = ipv6ToBytes(ip);
  const b = ipv6ToBytes(range);
  if (!a || !b || bits > 128) return false;
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (a[i] !== b[i]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const maskByte = (0xff << (8 - remaining)) & 0xff;
  return (a[fullBytes] & maskByte) === (b[fullBytes] & maskByte);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = ((out << 8) | n) >>> 0;
  }
  return out;
}

function ipv6ToBytes(ip: string): Uint8Array | null {
  // Handle :: zero-compression and embedded IPv4 (e.g. ::ffff:1.2.3.4 already
  // stripped above; but a CIDR range might still contain it).
  const ipv4Match = /:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  let ipv6Part = ip;
  let ipv4Tail: number[] | null = null;
  if (ipv4Match) {
    const v4 = ipv4ToInt(ipv4Match[1]);
    if (v4 == null) return null;
    ipv4Tail = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff];
    ipv6Part = ip.slice(0, ip.length - ipv4Match[0].length + 1);
    if (ipv6Part.endsWith(":") && !ipv6Part.endsWith("::")) {
      ipv6Part = ipv6Part.slice(0, -1);
    }
  }

  const halves = ipv6Part.split("::");
  if (halves.length > 2) return null;

  const expand = (s: string): string[] => (s ? s.split(":") : []);
  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];

  const groupsTotal = ipv4Tail ? 6 : 8;
  const presentGroups = head.length + tail.length;
  if (presentGroups > groupsTotal) return null;

  const fillCount = halves.length === 2 ? groupsTotal - presentGroups : 0;
  if (halves.length === 1 && presentGroups !== groupsTotal) return null;

  const groups = [...head, ...new Array(fillCount).fill("0"), ...tail];

  const bytes = new Uint8Array(16);
  for (let i = 0; i < groups.length; i++) {
    const v = parseInt(groups[i], 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    bytes[i * 2] = (v >>> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  if (ipv4Tail) {
    bytes[12] = ipv4Tail[0];
    bytes[13] = ipv4Tail[1];
    bytes[14] = ipv4Tail[2];
    bytes[15] = ipv4Tail[3];
  }
  return bytes;
}
