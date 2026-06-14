/**
 * Integration tests for POST /api/kody/secrets/vault — the master-key unlock
 * endpoint that returns decrypted secret values. Security boundaries:
 * auth is required, vault must be configured, the key must match keyCheck,
 * and — critically — secret VALUES are only returned when the correct key
 * is supplied.
 *
 * Auth and the vault store are mocked; the real verifyKey function is used
 * so the "wrong key" and "correct key" assertions are genuine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn<(req: unknown) => Promise<unknown>>(async () => null),
  getUserOctokit: vi.fn<(req: unknown) => Promise<unknown>>(async () => ({})),
  getRequestAuth: vi.fn<(req: unknown) => unknown>(() => ({
    owner: "acme",
    repo: "widgets",
    token: "t",
  })),
}));
const store = vi.hoisted(() => ({
  readVault: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidateVaultCache: vi.fn<(owner: string, repo: string) => void>(),
}));
const cfg = vi.hoisted(() => ({ isVaultConfigured: vi.fn(() => true) }));
const loggerStub = vi.hoisted(() => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/vault/crypto", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dashboard/lib/vault/crypto")>();
  return {
    ...actual,
    isVaultConfigured: cfg.isVaultConfigured,
  };
});
vi.mock("@dashboard/lib/logger", () => loggerStub);
vi.mock("@dashboard/lib/vault/store", async (importActual) => {
  const actual =
    await importActual<typeof import("@dashboard/lib/vault/store")>();
  return {
    ...actual,
    readVault: store.readVault,
    invalidateVaultCache: store.invalidateVaultCache,
  };
});

import { POST } from "../../app/api/kody/secrets/vault/route";
import { deriveKeyCheck } from "../../src/dashboard/lib/vault/crypto";

function makeReq(body: unknown) {
  return new NextRequest("https://dash.test/api/kody/secrets/vault", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const CORRECT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64-char hex = 32 bytes
const WRONG_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const KEY_CHECK = deriveKeyCheck(CORRECT_KEY);

const MOCK_DOC_WITH_KEYCHECK = {
  version: 1,
  secrets: {
    API_KEY: {
      value: "sk-secret-123",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "alice",
    },
  },
  keyCheck: KEY_CHECK,
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getUserOctokit.mockResolvedValue({});
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "t",
  });
  cfg.isVaultConfigured.mockReturnValue(true);
});

describe("POST /api/kody/secrets/vault", () => {
  it("returns 401-style auth error when unauthenticated", async () => {
    auth.requireKodyAuth.mockResolvedValue(
      NextResponse.json({ error: "unauth" }, { status: 401 }),
    );
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when the vault is not configured", async () => {
    cfg.isVaultConfigured.mockReturnValue(false);
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "vault_not_configured" });
  });

  it("returns 400 when there is no repo context", async () => {
    auth.getRequestAuth.mockReturnValue(null);
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(makeReq("{ not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when vault has no keyCheck (not initialised via the UI)", async () => {
    store.readVault.mockResolvedValue({
      doc: { version: 1, secrets: {} },
      sha: null,
    });
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "vault_not_initialized",
    });
  });

  it("returns 400 when the wrong key is supplied", async () => {
    store.readVault.mockResolvedValue({
      doc: MOCK_DOC_WITH_KEYCHECK,
      sha: "vault-sha",
    });
    const res = await POST(makeReq({ key: WRONG_KEY }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_key" });
  });

  it("returns decrypted secrets when the correct key is supplied", async () => {
    store.readVault.mockResolvedValue({
      doc: MOCK_DOC_WITH_KEYCHECK,
      sha: "vault-sha",
    });
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.secrets).toEqual([
      {
        name: "API_KEY",
        value: "sk-secret-123",
        updatedAt: "2026-01-01T00:00:00Z",
        updatedBy: "alice",
      },
    ]);
  });

  it("returns all secrets sorted by name when correct key is supplied", async () => {
    store.readVault.mockResolvedValue({
      doc: {
        version: 1,
        secrets: {
          ZEBRA_KEY: { value: "z-value", updatedAt: "2026-01-02T00:00:00Z" },
          ALPHA_KEY: { value: "a-value", updatedAt: "2026-01-01T00:00:00Z" },
        },
        keyCheck: KEY_CHECK,
      },
      sha: "vault-sha",
    });
    const res = await POST(makeReq({ key: CORRECT_KEY }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.secrets.map((s: { name: string }) => s.name)).toEqual([
      "ALPHA_KEY",
      "ZEBRA_KEY",
    ]);
  });
});
