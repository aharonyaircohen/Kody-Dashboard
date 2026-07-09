/**
 * @fileoverview Unit tests for the client-surface scope tickets
 *   (phase 2 step 6 — server-side surface scoping).
 * @testFramework vitest
 * @domain chat-platform
 *
 * Covers: mint/verify roundtrip, expiry, tampering (slug/repo/signature),
 * malformed tickets, purpose separation from the chat-token and
 * plugin-tools HMAC families, scope resolution precedence (admin PAT wins,
 * ticket-only → client, neither → none) and the admin-only endpoint guard.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  CLIENT_SURFACE_TOOL_ALLOWLIST,
  mintClientSurfaceTicket,
  rejectSurfaceScopedRequest,
  resolveSurfaceScope,
  SURFACE_TICKET_HEADER,
  SURFACE_TICKET_TTL_SEC,
  verifySurfaceTicket,
} from "@dashboard/lib/chat/platform/surface-scope";
import { mintSessionToken } from "@dashboard/lib/chat-token";
import { mintPluginToolsToken } from "@dashboard/lib/chat/platform/plugin-tools-config";

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "test-secret-for-surface-scope-hmac";
});

const BRAND = { brandSlug: "acme", owner: "acme-co", repo: "widgets" };

function decode(ticket: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
}

function encode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

describe("surface ticket mint/verify", () => {
  it("roundtrips a valid ticket with the 4h default expiry", () => {
    const { ticket, expiresAt } = mintClientSurfaceTicket(BRAND);
    const now = Math.floor(Date.now() / 1000);
    expect(expiresAt).toBeGreaterThanOrEqual(now + SURFACE_TICKET_TTL_SEC - 5);
    expect(expiresAt).toBeLessThanOrEqual(now + SURFACE_TICKET_TTL_SEC + 5);

    const payload = verifySurfaceTicket(ticket);
    expect(payload).toMatchObject({
      f: "client",
      b: "acme",
      o: "acme-co",
      r: "widgets",
      e: expiresAt,
    });
  });

  it("rejects expired tickets", () => {
    const { ticket } = mintClientSurfaceTicket({ ...BRAND, ttlSec: -10 });
    expect(verifySurfaceTicket(ticket)).toBeNull();
  });

  it("rejects tampered brand, repo, expiry, and signature", () => {
    const { ticket } = mintClientSurfaceTicket(BRAND);
    const payload = decode(ticket);

    expect(verifySurfaceTicket(encode({ ...payload, b: "evil" }))).toBeNull();
    expect(verifySurfaceTicket(encode({ ...payload, o: "evil" }))).toBeNull();
    expect(verifySurfaceTicket(encode({ ...payload, r: "other" }))).toBeNull();
    expect(
      verifySurfaceTicket(
        encode({ ...payload, e: (payload.e as number) + 60 }),
      ),
    ).toBeNull();
    expect(
      verifySurfaceTicket(encode({ ...payload, s: "0".repeat(32) })),
    ).toBeNull();
    // Hex-shape guard: appending to the sig must not verify.
    expect(
      verifySurfaceTicket(encode({ ...payload, s: `${payload.s}0` })),
    ).toBeNull();
  });

  it("rejects malformed tickets", () => {
    expect(verifySurfaceTicket("")).toBeNull();
    expect(verifySurfaceTicket("not-base64-json")).toBeNull();
    expect(verifySurfaceTicket(encode({ f: "admin" }))).toBeNull();
    expect(verifySurfaceTicket(encode({ f: "client", b: "x" }))).toBeNull();
  });

  it("is purpose-separated from the chat-token and plugin-tools families", () => {
    const { ticket } = mintClientSurfaceTicket(BRAND);
    const payload = decode(ticket);
    const subjectLike = `client|acme|acme-co/widgets:${payload.e}`;
    // Same master key, different purpose prefix → different signatures.
    expect(payload.s).not.toBe(mintSessionToken(subjectLike));
    expect(payload.s).not.toBe(mintPluginToolsToken("acme-co", "widgets"));
  });
});

describe("resolveSurfaceScope", () => {
  const adminHeaders = {
    "x-kody-token": "ghp_test",
    "x-kody-owner": "acme-co",
    "x-kody-repo": "widgets",
  };

  it("resolves admin scope from PAT headers, even with a ticket present", () => {
    const { ticket } = mintClientSurfaceTicket(BRAND);
    expect(resolveSurfaceScope(new Headers(adminHeaders))).toEqual({
      kind: "admin",
    });
    expect(
      resolveSurfaceScope(
        new Headers({ ...adminHeaders, [SURFACE_TICKET_HEADER]: ticket }),
      ),
    ).toEqual({ kind: "admin" });
  });

  it("resolves client scope from a valid ticket without a PAT", () => {
    const { ticket, expiresAt } = mintClientSurfaceTicket(BRAND);
    expect(
      resolveSurfaceScope(new Headers({ [SURFACE_TICKET_HEADER]: ticket })),
    ).toEqual({
      kind: "client",
      brandSlug: "acme",
      owner: "acme-co",
      repo: "widgets",
      expiresAt,
    });
  });

  it("resolves none for missing or invalid credentials", () => {
    expect(resolveSurfaceScope(new Headers())).toEqual({ kind: "none" });
    expect(
      resolveSurfaceScope(new Headers({ [SURFACE_TICKET_HEADER]: "garbage" })),
    ).toEqual({ kind: "none" });
    // Partial PAT headers are not admin auth.
    expect(
      resolveSurfaceScope(new Headers({ "x-kody-token": "ghp_test" })),
    ).toEqual({ kind: "none" });
  });
});

describe("rejectSurfaceScopedRequest (admin-only endpoints)", () => {
  it("403s ticket-only requests, passes PAT and unauthenticated through", async () => {
    const { ticket } = mintClientSurfaceTicket(BRAND);

    const rejection = rejectSurfaceScopedRequest(
      new Headers({ [SURFACE_TICKET_HEADER]: ticket }),
    );
    expect(rejection?.status).toBe(403);
    expect((await rejection?.json())?.error).toBe("surface_scope_forbidden");

    expect(
      rejectSurfaceScopedRequest(
        new Headers({
          "x-kody-token": "ghp_test",
          "x-kody-owner": "acme-co",
          "x-kody-repo": "widgets",
        }),
      ),
    ).toBeNull();
    expect(rejectSurfaceScopedRequest(new Headers())).toBeNull();
  });
});

describe("client surface tool allowlist", () => {
  it("stays a conservative read-only subset (documented contract)", () => {
    expect([...CLIENT_SURFACE_TOOL_ALLOWLIST].sort()).toEqual([
      "describe_feature",
      "fetch_url",
      "list_dashboard_features",
    ]);
  });
});
