import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const github = vi.hoisted(() => ({
  createUserOctokit: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: github.createUserOctokit,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function makeReq(headers?: Record<string, string>) {
  return new NextRequest("https://dash.test/api/kody/test", { headers });
}

function authHeaders(login = "alice") {
  return {
    "x-kody-token": `token-${login}`,
    "x-kody-owner": "acme",
    "x-kody-repo": "widgets",
  };
}

async function loadAuth() {
  vi.resetModules();
  return import("@dashboard/lib/auth");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  github.createUserOctokit.mockReset();
});

describe("dashboard auth contract", () => {
  it("does not treat env tokens as user request auth by default", async () => {
    vi.stubEnv("KODY_BOT_TOKEN", "bot-token");
    const { requireKodyAuth } = await loadAuth();

    const res = await requireKodyAuth(makeReq());

    expect(res?.status).toBe(401);
  });

  it("allows env tokens only when the caller opts in", async () => {
    vi.stubEnv("KODY_BOT_TOKEN", "bot-token");
    const { requireKodyAuth } = await loadAuth();

    await expect(
      requireKodyAuth(makeReq(), { allowEnvToken: true }),
    ).resolves.toBeNull();
  });

  it("resolves actor identity from the request token", async () => {
    github.createUserOctokit.mockReturnValue({
      rest: {
        users: {
          getAuthenticated: vi.fn(async () => ({
            data: {
              login: "alice",
              id: 42,
              avatar_url: "https://example.test/a.png",
            },
          })),
        },
      },
    });
    const { verifyActorLogin } = await loadAuth();

    const result = await verifyActorLogin(makeReq(authHeaders()), "alice");

    expect("identity" in result && result.identity.login).toBe("alice");
  });

  it("rejects a supplied actor that does not own the token", async () => {
    github.createUserOctokit.mockReturnValue({
      rest: {
        users: {
          getAuthenticated: vi.fn(async () => ({
            data: {
              login: "alice",
              id: 42,
              avatar_url: "https://example.test/a.png",
            },
          })),
        },
      },
    });
    const { verifyActorLogin } = await loadAuth();

    const result = await verifyActorLogin(makeReq(authHeaders()), "bob");

    expect("status" in result && result.status).toBe(403);
  });
});
