/**
 * Integration tests for the secrets vault API (app/api/kody/secrets/route.ts).
 * This is the write path for repo-scoped secrets — a security boundary that
 * AES-encrypts third-party API keys into the repo. It had no test. The
 * load-bearing properties: auth is required, the vault must be configured,
 * input is strictly validated, and — critically — secret VALUES are never
 * echoed back in any response (only metadata).
 *
 * Auth and the vault store are mocked, but `listSecretMetadata` (the
 * value-stripping projection) is the REAL implementation, so the
 * "never returns the value" assertions are genuine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn<(req: unknown) => Promise<unknown>>(async () => null), // null = authenticated
  verifyActorLogin: vi.fn<(req: unknown, login?: string) => Promise<unknown>>(
    async () => ({ identity: { login: "alice" } }),
  ),
  getUserOctokit: vi.fn<(req: unknown) => Promise<unknown>>(async () => ({})), // truthy octokit
  getRequestAuth: vi.fn<(req: unknown) => unknown>(() => ({
    owner: "acme",
    repo: "widgets",
    token: "t",
  })),
}));
const store = vi.hoisted(() => ({
  readVault: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  writeVault: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  invalidateVaultCache: vi.fn<(owner: string, repo: string) => void>(),
}));
const cfg = vi.hoisted(() => ({ isVaultConfigured: vi.fn(() => true) }));
const act = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/vault/crypto", () => cfg);
vi.mock("@dashboard/lib/activity/audit", () => act);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// Partial mock: keep the real value-stripping `listSecretMetadata`.
vi.mock("@dashboard/lib/vault/store", async (importActual) => {
  const actual =
    await importActual<typeof import("@dashboard/lib/vault/store")>();
  return {
    ...actual,
    readVault: store.readVault,
    writeVault: store.writeVault,
    invalidateVaultCache: store.invalidateVaultCache,
  };
});

import { GET, POST } from "../../app/api/kody/secrets/route";

function makeReq(body?: unknown) {
  return new NextRequest("https://dash.test/api/kody/secrets", {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined
      ? {}
      : {
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
  });
}

const SECRET_VALUE = "sk-proj-DO-NOT-LEAK-1234567890";

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
  auth.getUserOctokit.mockResolvedValue({});
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "t",
  });
  cfg.isVaultConfigured.mockReturnValue(true);
  store.readVault.mockResolvedValue({
    doc: {
      secrets: {
        EXISTING_KEY: {
          value: SECRET_VALUE,
          updatedAt: "2026-01-01T00:00:00Z",
          updatedBy: "bob",
        },
      },
    },
    sha: "vault-sha",
  });
});

describe("GET /api/kody/secrets", () => {
  it("returns 401-style auth error when unauthenticated", async () => {
    auth.requireKodyAuth.mockResolvedValue(
      NextResponse.json({ error: "unauth" }, { status: 401 }),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 503 when the vault is not configured", async () => {
    cfg.isVaultConfigured.mockReturnValue(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "vault_not_configured" });
  });

  it("returns 400 when there is no repo context", async () => {
    auth.getRequestAuth.mockReturnValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
  });

  it("lists secret names + metadata but NEVER the value", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.secrets).toEqual([
      {
        name: "EXISTING_KEY",
        updatedAt: "2026-01-01T00:00:00Z",
        updatedBy: "bob",
      },
    ]);
    expect(JSON.stringify(json)).not.toContain(SECRET_VALUE);
  });
});

describe("POST /api/kody/secrets", () => {
  it("returns 400 on malformed JSON", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid secret name", async () => {
    const res = await POST(makeReq({ name: "lower-case", value: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
  });

  it("rejects an empty value", async () => {
    const res = await POST(makeReq({ name: "API_KEY", value: "" }));
    expect(res.status).toBe(400);
  });

  it("returns the actor-verification error response when login check fails", async () => {
    auth.verifyActorLogin.mockResolvedValue(
      NextResponse.json({ error: "actor_mismatch" }, { status: 403 }),
    );
    const res = await POST(makeReq({ name: "API_KEY", value: "v" }));
    expect(res.status).toBe(403);
    expect(store.writeVault).not.toHaveBeenCalled();
  });

  it("upserts the secret, invalidates cache, records the action, and never echoes the value", async () => {
    const res = await POST(
      makeReq({ name: "NEW_KEY", value: "super-secret-zzz" }),
    );
    expect(res.status).toBe(200);

    // The encrypted write got the new value (internally) ...
    expect(store.writeVault).toHaveBeenCalledTimes(1);
    const writtenDoc = store.writeVault.mock.calls[0][3] as {
      secrets: Record<string, { value: string; updatedBy: string }>;
    };
    expect(writtenDoc.secrets.NEW_KEY.value).toBe("super-secret-zzz");
    expect(writtenDoc.secrets.NEW_KEY.updatedBy).toBe("alice");

    expect(store.invalidateVaultCache).toHaveBeenCalledWith("acme", "widgets");
    expect(act.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "vault.write", resource: "NEW_KEY" }),
    );

    // ... but the HTTP response carries only metadata, never any value.
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(JSON.stringify(json)).not.toContain("super-secret-zzz");
    expect(JSON.stringify(json)).not.toContain(SECRET_VALUE);
  });
});
