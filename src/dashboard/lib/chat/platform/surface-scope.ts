/**
 * @fileType module
 * @domain chat-platform
 * @pattern surface-scope-ticket
 * @ai-summary Phase 2 Step 6 — server-side surface scoping. Mints/verifies
 *   HMAC "surface tickets" that bind a restricted chat scope
 *   ({surface: client, brandSlug, owner/repo, expiry}) so /client brand
 *   surfaces can eventually face external users without a GitHub PAT.
 *   Signing follows the preview-token/plugin-tools pattern: HMAC-SHA256 of
 *   the subject with KODY_MASTER_KEY, purpose-prefixed (`kody-surface:`) so
 *   this family is cryptographically separated from every other consumer of
 *   the same key. No new env var.
 *
 *   Enforcement contract (additive, fail-open for admin):
 *   - Admin requests (x-kody-token/owner/repo PAT headers) → full scope,
 *     byte-identical behavior to before this module existed.
 *   - Requests carrying ONLY a valid surface ticket → restricted scope:
 *     the in-process kody endpoint only, agent forced to the brand default,
 *     tool set filtered to CLIENT_SURFACE_TOOL_ALLOWLIST.
 *   - Neither → the route's existing 401, unchanged.
 *
 *   Dormant today: ClientChatSurface still authenticates with the logged-in
 *   PAT and does not send tickets. This module ships the enforcement path
 *   for the external-user launch.
 */

import "server-only";

import crypto from "crypto";
import { NextResponse } from "next/server";

import { KODY_AUTH_HEADERS } from "@dashboard/lib/auth-headers";

/** Header the client surface will send its ticket in at launch. */
export const SURFACE_TICKET_HEADER = "x-kody-surface-ticket";

/** Default ticket lifetime — same 4h discipline as preview tickets. */
export const SURFACE_TICKET_TTL_SEC = 4 * 60 * 60;

const HMAC_BYTES = 16; // 128 bits — matches chat-token / preview-token

/**
 * Tools a surface-scoped (external, PAT-less) chat turn may call, beyond the
 * always-preserved chat protocol tools (final_answer / show_view). Chosen
 * conservatively from the tools the kody route can build WITHOUT a repo
 * token: read-only feature discovery + public URL fetch. Everything
 * repo-scoped (GitHub/task/secret/… tools) is impossible without a PAT and
 * additionally excluded here by allowlist, defense-in-depth.
 */
export const CLIENT_SURFACE_TOOL_ALLOWLIST: readonly string[] = [
  "fetch_url",
  "list_dashboard_features",
  "describe_feature",
];

function getSecret(): string {
  const s = process.env.KODY_MASTER_KEY;
  if (!s) throw new Error("KODY_MASTER_KEY not configured");
  // Purpose prefix separates this HMAC family from kody-chat-token:,
  // kody-preview:, kody-plugin-tools:, … (same master key, distinct use).
  return `kody-surface:${s}`;
}

export interface SurfaceTicketPayload {
  /** Surface kind — only "client" exists today. */
  f: "client";
  /** Brand slug the ticket was minted for. */
  b: string;
  /** Repo owner the brand surface is bound to. */
  o: string;
  /** Repo name the brand surface is bound to. */
  r: string;
  /** Unix expiry (seconds). */
  e: number;
  /** Hex HMAC signature over the subject. */
  s: string;
}

function buildSubject(p: Omit<SurfaceTicketPayload, "s">): string {
  return `${p.f}|${p.b}|${p.o}/${p.r}:${p.e}`;
}

function sign(subject: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);
}

/**
 * Mint a client-surface ticket. Opaque base64url of the JSON payload —
 * self-describing (scope rides inside), stateless (verify by re-signing).
 */
export function mintClientSurfaceTicket(options: {
  brandSlug: string;
  owner: string;
  repo: string;
  ttlSec?: number;
}): { ticket: string; expiresAt: number } {
  const exp =
    Math.floor(Date.now() / 1000) + (options.ttlSec ?? SURFACE_TICKET_TTL_SEC);
  const unsigned = {
    f: "client" as const,
    b: options.brandSlug,
    o: options.owner,
    r: options.repo,
    e: exp,
  };
  const payload: SurfaceTicketPayload = {
    ...unsigned,
    s: sign(buildSubject(unsigned)),
  };
  return {
    ticket: Buffer.from(JSON.stringify(payload)).toString("base64url"),
    expiresAt: exp,
  };
}

function decodeTicket(ticket: string): SurfaceTicketPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (
    p.f !== "client" ||
    typeof p.b !== "string" ||
    typeof p.o !== "string" ||
    typeof p.r !== "string" ||
    typeof p.e !== "number" ||
    typeof p.s !== "string"
  ) {
    return null;
  }
  return p as unknown as SurfaceTicketPayload;
}

/**
 * Verify a surface ticket: shape, expiry, then constant-time HMAC check.
 * Returns the payload on success, null on any failure (never throws —
 * a missing KODY_MASTER_KEY reads as "no valid ticket").
 */
export function verifySurfaceTicket(
  ticket: string,
): SurfaceTicketPayload | null {
  const payload = decodeTicket(ticket);
  if (!payload) return null;

  // Expiry first — no crypto work for dead tickets.
  if (Math.floor(Date.now() / 1000) >= payload.e) return null;

  // Exact-shape check first: Buffer.from(.., "hex") silently truncates
  // odd-length / partially-invalid hex (same guard as plugin-tools bearer).
  if (!/^[a-f0-9]{32}$/.test(payload.s)) return null;

  let expected: string;
  try {
    expected = sign(buildSubject(payload));
  } catch {
    return null;
  }
  const a = Buffer.from(payload.s, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return null;
  try {
    return crypto.timingSafeEqual(a, b) ? payload : null;
  } catch {
    return null;
  }
}

// ─── Request-scope resolution ────────────────────────────────────────────────

export type SurfaceScope =
  /** PAT-authenticated admin request — full scope, behavior unchanged. */
  | { kind: "admin" }
  /** Valid surface ticket, no PAT — restricted client-surface scope. */
  | {
      kind: "client";
      brandSlug: string;
      owner: string;
      repo: string;
      expiresAt: number;
    }
  /** Neither — the route's existing auth handling (401) applies. */
  | { kind: "none" };

function hasAdminAuth(headers: Headers): boolean {
  return Boolean(
    headers.get(KODY_AUTH_HEADERS.token) &&
    headers.get(KODY_AUTH_HEADERS.owner) &&
    headers.get(KODY_AUTH_HEADERS.repo),
  );
}

/**
 * Resolve the surface scope for a request. Admin PAT headers ALWAYS win —
 * a ticket riding along with a PAT is ignored, so admin behavior stays
 * byte-identical even if a future client sends both.
 */
export function resolveSurfaceScope(headers: Headers): SurfaceScope {
  if (hasAdminAuth(headers)) return { kind: "admin" };

  const ticket = headers.get(SURFACE_TICKET_HEADER);
  if (ticket) {
    const payload = verifySurfaceTicket(ticket);
    if (payload) {
      return {
        kind: "client",
        brandSlug: payload.b,
        owner: payload.o,
        repo: payload.r,
        expiresAt: payload.e,
      };
    }
  }
  return { kind: "none" };
}

/**
 * Guard for admin-only chat endpoints (trigger, brain): a request whose only
 * credential is a surface ticket is explicitly forbidden (403) — those
 * backends dispatch runners / proxy the Brain and must never be reachable
 * from an external brand surface. PAT requests pass through untouched
 * (returns null → the route's own requireKodyAuth runs as today); ticket-less
 * unauthenticated requests also return null and fall through to today's 401.
 */
export function rejectSurfaceScopedRequest(
  headers: Headers,
): NextResponse | null {
  const scope = resolveSurfaceScope(headers);
  if (scope.kind !== "client") return null;
  return NextResponse.json(
    {
      error: "surface_scope_forbidden",
      message:
        "Surface tickets are limited to the in-process chat endpoint (/api/kody/chat/kody).",
    },
    { status: 403 },
  );
}
