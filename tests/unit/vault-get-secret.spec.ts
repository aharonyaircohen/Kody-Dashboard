/**
 * Unit tests for the runtime secret resolver
 * (src/dashboard/lib/vault/get-secret.ts). This is the seam every server
 * route uses to read a secret; the load-bearing rule is "vault first, then
 * fall through to process.env" so both bootstrap and unconfigured-repo CI
 * paths keep working. Was at 0% coverage.
 *
 * Dependencies (auth, octokit factory, vault store, vault config) are
 * mocked at the import boundary so we can drive each branch deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mGetRequestAuth, mCreateUserOctokit, mReadVault, mIsVaultConfigured } =
  vi.hoisted(() => ({
    mGetRequestAuth: vi.fn(),
    mCreateUserOctokit: vi.fn(() => ({})),
    mReadVault: vi.fn(),
    mIsVaultConfigured: vi.fn(),
  }));

vi.mock("@dashboard/lib/auth", () => ({ getRequestAuth: mGetRequestAuth }));
vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: mCreateUserOctokit,
}));
vi.mock("@dashboard/lib/vault/store", () => ({ readVault: mReadVault }));
vi.mock("@dashboard/lib/vault/crypto", () => ({
  isVaultConfigured: mIsVaultConfigured,
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { getSecret } from "@dashboard/lib/vault/get-secret";

// The resolver only reads getRequestAuth(req), so a bare object suffices.
const req = {} as never;
const AUTH = { token: "ghp_x", owner: "acme", repo: "widgets" };

function vaultWith(secrets: Record<string, { value: string }>) {
  mReadVault.mockResolvedValue({ doc: { secrets } });
}

let savedEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = process.env.MY_SECRET;
  delete process.env.MY_SECRET;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.MY_SECRET;
  else process.env.MY_SECRET = savedEnv;
});

describe("getSecret", () => {
  it("returns the vault value when configured, authed, and present", async () => {
    mIsVaultConfigured.mockReturnValue(true);
    mGetRequestAuth.mockReturnValue(AUTH);
    vaultWith({ MY_SECRET: { value: "from-vault" } });
    process.env.MY_SECRET = "from-env"; // vault must win

    expect(await getSecret("MY_SECRET", { req })).toBe("from-vault");
    expect(mReadVault).toHaveBeenCalledWith(expect.anything(), "acme", "widgets");
  });

  it("falls through to process.env when the vault has no such entry", async () => {
    mIsVaultConfigured.mockReturnValue(true);
    mGetRequestAuth.mockReturnValue(AUTH);
    vaultWith({});
    process.env.MY_SECRET = "from-env";

    expect(await getSecret("MY_SECRET", { req })).toBe("from-env");
  });

  it("falls through to process.env when the vault is not configured", async () => {
    mIsVaultConfigured.mockReturnValue(false);
    process.env.MY_SECRET = "from-env";

    expect(await getSecret("MY_SECRET", { req })).toBe("from-env");
    expect(mReadVault).not.toHaveBeenCalled();
  });

  it("falls through to process.env when the request has no connected repo", async () => {
    mIsVaultConfigured.mockReturnValue(true);
    mGetRequestAuth.mockReturnValue(null); // no auth headers
    process.env.MY_SECRET = "from-env";

    expect(await getSecret("MY_SECRET", { req })).toBe("from-env");
    expect(mReadVault).not.toHaveBeenCalled();
  });

  it("falls back to env when the vault read throws", async () => {
    mIsVaultConfigured.mockReturnValue(true);
    mGetRequestAuth.mockReturnValue(AUTH);
    mReadVault.mockRejectedValue(new Error("boom"));
    process.env.MY_SECRET = "from-env";

    expect(await getSecret("MY_SECRET", { req })).toBe("from-env");
  });

  it("returns null when nothing resolves the secret", async () => {
    mIsVaultConfigured.mockReturnValue(false);
    expect(await getSecret("MY_SECRET", { req })).toBeNull();
  });

  it("does not fall back to env when vaultOnly is set", async () => {
    mIsVaultConfigured.mockReturnValue(true);
    mGetRequestAuth.mockReturnValue(AUTH);
    vaultWith({}); // entry absent
    process.env.MY_SECRET = "from-env";

    expect(await getSecret("MY_SECRET", { req, vaultOnly: true })).toBeNull();
  });
});
