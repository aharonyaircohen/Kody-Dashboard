import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const getRequestAuth = vi.fn();
const getUserOctokit = vi.fn();
const resolveActorFromToken = vi.fn();
const getEngineConfig = vi.fn();
const readVault = vi.fn();

vi.mock("@dashboard/lib/auth", () => ({
  getRequestAuth: (...args: unknown[]) => getRequestAuth(...args),
  getUserOctokit: (...args: unknown[]) => getUserOctokit(...args),
  resolveActorFromToken: (...args: unknown[]) => resolveActorFromToken(...args),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: (...args: unknown[]) => getEngineConfig(...args),
}));

vi.mock("@dashboard/lib/vault/store", () => ({
  readVault: (...args: unknown[]) => readVault(...args),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

function req(): NextRequest {
  return {
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest;
}

function vault(secrets: Record<string, string>) {
  return {
    doc: {
      secrets: Object.fromEntries(
        Object.entries(secrets).map(([name, value]) => [name, { value }]),
      ),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("FLY_API_TOKEN", "");
  vi.stubEnv("FLY_IO_TOKEN", "");
  getRequestAuth.mockReturnValue({
    token: "ghp_user",
    owner: "acme",
    repo: "widgets",
  });
  getUserOctokit.mockResolvedValue({ repos: {} });
  resolveActorFromToken.mockResolvedValue({ login: "alice" });
  getEngineConfig.mockResolvedValue({ config: { agent: { model: "m/x" } } });
  readVault.mockResolvedValue(
    vault({ FLY_API_TOKEN: "fly_vault", MINIMAX_API_KEY: "mini" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("resolveFlyContext", () => {
  it("prefers the connected repo vault Fly token over server env", async () => {
    vi.stubEnv("FLY_API_TOKEN", "fly_server");

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.flyToken).toBe("fly_vault");
    expect(result.context.allSecrets).toEqual({ MINIMAX_API_KEY: "mini" });
  });

  it("falls back to server env when the vault has no Fly token", async () => {
    vi.stubEnv("FLY_API_TOKEN", "fly_server");
    readVault.mockResolvedValue(vault({ GEMINI_API_KEY: "gemini" }));

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.flyToken).toBe("fly_server");
    expect(result.context.allSecrets).toEqual({ GEMINI_API_KEY: "gemini" });
  });
});
