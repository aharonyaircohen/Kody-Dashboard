import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "dashboard",
  })),
}));

const webhook = vi.hoisted(() => ({
  ensureWebhook: vi.fn(async () => ({ ok: true, created: true, hookId: 123 })),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
}));

vi.mock("@dashboard/lib/auth/oauth-url", () => ({
  getPublicBaseUrl: vi.fn(() => "https://dash.test"),
}));

vi.mock("@dashboard/lib/webhooks/register", () => ({
  ensureWebhook: webhook.ensureWebhook,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://dash.test${path}`, init);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/../app/api/kody/orgs/[org]/repos/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe("org repos route", () => {
  it("lists only GitHub repos owned by the selected org", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse([
        {
          name: "dashboard",
          full_name: "acme/dashboard",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/acme/dashboard",
          owner: { login: "acme" },
        },
        {
          name: "other",
          full_name: "other/other",
          private: false,
          default_branch: "main",
          html_url: "https://github.com/other/other",
          owner: { login: "other" },
        },
      ]),
    );

    const { GET } = await loadRoute();
    const res = await GET(req("/api/kody/orgs/acme/repos"), {
      params: Promise.resolve({ org: "acme" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repositories).toEqual([
      {
        name: "dashboard",
        fullName: "acme/dashboard",
        private: true,
        defaultBranch: "main",
        htmlUrl: "https://github.com/acme/dashboard",
        owner: "acme",
      },
    ]);
  });

  it("creates a personal repo when org matches the token owner", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({ login: "alice", avatar_url: "u", id: 42 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: "new-app",
          full_name: "alice/new-app",
          private: false,
          default_branch: "main",
          html_url: "https://github.com/alice/new-app",
        }),
      );

    const { POST } = await loadRoute();
    const res = await POST(
      req("/api/kody/orgs/alice/repos", {
        method: "POST",
        body: JSON.stringify({ name: "new-app", private: false }),
      }),
      { params: Promise.resolve({ org: "alice" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe(
      "https://api.github.com/user/repos",
    );
    expect(body.repository.fullName).toBe("alice/new-app");
    expect(webhook.ensureWebhook).toHaveBeenCalledWith({
      token: "ghp_test",
      owner: "alice",
      repo: "new-app",
      hookUrl: "https://dash.test/api/webhooks/github",
    });
  });

  it("creates an org repo when org differs from the token owner", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({ login: "alice", avatar_url: "u", id: 42 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: "new-service",
          full_name: "acme/new-service",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/acme/new-service",
        }),
      );

    const { POST } = await loadRoute();
    const res = await POST(
      req("/api/kody/orgs/acme/repos", {
        method: "POST",
        body: JSON.stringify({
          name: "new-service",
          private: true,
          autoInit: true,
        }),
      }),
      { params: Promise.resolve({ org: "acme" }) },
    );

    expect(res.status).toBe(201);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe(
      "https://api.github.com/orgs/acme/repos",
    );
    expect(JSON.parse(String(vi.mocked(global.fetch).mock.calls[1][1]?.body))).toMatchObject(
      {
        name: "new-service",
        private: true,
        auto_init: true,
      },
    );
  });
});
