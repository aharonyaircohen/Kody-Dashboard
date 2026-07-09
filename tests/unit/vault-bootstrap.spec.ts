import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encrypt } from "@dashboard/lib/vault/crypto";
import { resolveVaultGithubToken } from "@dashboard/lib/vault/bootstrap";

const KEY = randomBytes(32).toString("hex");
let savedKey: string | undefined;

function contentsResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => ({
      content: Buffer.from(
        typeof value === "string" ? value : JSON.stringify(value),
        "utf8",
      ).toString("base64"),
      encoding: "base64",
    }),
  } as Response;
}

describe("resolveVaultGithubToken", () => {
  beforeEach(() => {
    savedKey = process.env.KODY_MASTER_KEY;
    process.env.KODY_MASTER_KEY = KEY;
  });

  afterEach(() => {
    process.env.KODY_MASTER_KEY = savedKey;
    vi.restoreAllMocks();
  });

  it("reads secrets.enc from the configured state repo", async () => {
    const vaultDoc = {
      version: 1,
      secrets: {
        GITHUB_TOKEN: {
          value: "ghp_state_repo_token",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widgets/contents/kody.config.json")) {
        return contentsResponse({
          state: {
            repo: "https://github.com/acme/kody-state",
            path: "widgets",
          },
        });
      }
      if (url.endsWith("/repos/acme/kody-state/contents/widgets/secrets.enc")) {
        return contentsResponse(encrypt(JSON.stringify(vaultDoc)));
      }
      return { ok: false, json: async () => ({}) } as Response;
    });

    await expect(
      resolveVaultGithubToken("acme", "widgets", "GITHUB_TOKEN", fetchImpl),
    ).resolves.toBe("ghp_state_repo_token");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/acme/widgets/contents/kody.config.json",
      "https://api.github.com/repos/acme/kody-state/contents/widgets/secrets.enc",
    ]);
  });

  it("authenticates default-fetch reads with the server GITHUB_TOKEN", async () => {
    // Regression: these reads ran unauthenticated and shared Vercel's
    // 60-req/hr per-IP budget — when drained, every provider/vault read
    // 403'd and client sign-in rendered an empty page.
    const savedToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_server_token";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    try {
      await resolveVaultGithubToken("acme", "fresh-repo");
      expect(fetchSpy).toHaveBeenCalled();
      for (const [, init] of fetchSpy.mock.calls) {
        expect(
          (init?.headers as Record<string, string>)?.Authorization,
        ).toBe("Bearer ghp_server_token");
      }
    } finally {
      if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = savedToken;
    }
  });
});
