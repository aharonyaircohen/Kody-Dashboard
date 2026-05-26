/**
 * Unit tests for the GitHub App installation-token resolver
 * (src/dashboard/lib/auth/app-token.ts) and the background-token policy
 * (src/dashboard/lib/auth/background-token.ts).
 *
 * The App path lets unattended background work run as the bot rather than a
 * human PAT GitHub can flag. These tests pin the contract every webhook
 * dispatcher relies on:
 *   - unconfigured App (no env) → getInstallationToken returns null
 *   - configured + installed → mints a token (JWT → installation → token),
 *     caches it, and reuses the cache on the next call
 *   - App not installed (404 on the installation lookup) → null
 *   - background-token prefers the App token, falls back to vault, else null
 *
 * `fetch` is stubbed per-test; a throwaway RSA keypair stands in for the App
 * private key so JWT signing exercises the real node:crypto path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const h = vi.hoisted(() => ({ resolveVaultGithubToken: vi.fn() }));
vi.mock("@dashboard/lib/vault/bootstrap", () => ({
  resolveVaultGithubToken: h.resolveVaultGithubToken,
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const OWNER = "A-Guy-educ";
const REPO = "A-Guy";

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("app-token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    h.resolveVaultGithubToken.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the App is not configured", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    const { getInstallationToken, isAppConfigured } = await import(
      "@dashboard/lib/auth/app-token"
    );
    expect(isAppConfigured()).toBe(false);
    expect(await getInstallationToken(OWNER, REPO)).toBeNull();
  });

  it("mints and caches an installation token when configured + installed", async () => {
    vi.stubEnv("GITHUB_APP_ID", "3813056");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", PEM);

    const fetchMock = vi
      .fn()
      // installation lookup
      .mockResolvedValueOnce(okJson({ id: 135742721 }))
      // access token mint
      .mockResolvedValueOnce(okJson({ token: "ghs_installationtoken" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const { getInstallationToken } = await import(
      "@dashboard/lib/auth/app-token"
    );
    const first = await getInstallationToken(OWNER, REPO);
    expect(first).toBe("ghs_installationtoken");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call serves from cache — no further fetches.
    const second = await getInstallationToken(OWNER, REPO);
    expect(second).toBe("ghs_installationtoken");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when the App is not installed on the repo (404)", async () => {
    vi.stubEnv("GITHUB_APP_ID", "3813056");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", PEM);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ message: "Not Found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const { getInstallationToken } = await import(
      "@dashboard/lib/auth/app-token"
    );
    expect(await getInstallationToken(OWNER, REPO)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reaches token mint
  });

  it("accepts a base64-encoded private key", async () => {
    vi.stubEnv("GITHUB_APP_ID", "3813056");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      Buffer.from(PEM).toString("base64"),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ id: 1 }))
      .mockResolvedValueOnce(okJson({ token: "ghs_b64" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const { getInstallationToken } = await import(
      "@dashboard/lib/auth/app-token"
    );
    expect(await getInstallationToken(OWNER, REPO)).toBe("ghs_b64");
  });
});

describe("background-token policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    h.resolveVaultGithubToken.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefers the App token over vault", async () => {
    vi.stubEnv("GITHUB_APP_ID", "3813056");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", PEM);
    h.resolveVaultGithubToken.mockResolvedValue("vault_tok");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ id: 1 }))
      .mockResolvedValueOnce(okJson({ token: "ghs_app" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const { resolveBackgroundToken } = await import(
      "@dashboard/lib/auth/background-token"
    );
    const bg = await resolveBackgroundToken(OWNER, REPO);
    expect(bg).toEqual({ token: "ghs_app", source: "app" });
    expect(h.resolveVaultGithubToken).not.toHaveBeenCalled();
  });

  it("falls back to vault when the App is unconfigured", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    h.resolveVaultGithubToken.mockResolvedValue("vault_tok");

    const { resolveBackgroundToken } = await import(
      "@dashboard/lib/auth/background-token"
    );
    const bg = await resolveBackgroundToken(OWNER, REPO);
    expect(bg).toEqual({ token: "vault_tok", source: "vault" });
  });

  it("returns null when neither source yields a token", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    h.resolveVaultGithubToken.mockResolvedValue(null);

    const { resolveBackgroundToken } = await import(
      "@dashboard/lib/auth/background-token"
    );
    expect(await resolveBackgroundToken(OWNER, REPO)).toBeNull();
  });
});
