import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const github = vi.hoisted(() => ({
  createUserOctokit: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: github.createUserOctokit,
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  github.createUserOctokit.mockReset();
});

describe("GET /api/kody/auth/me", () => {
  it("does not report an env token as a browser login", async () => {
    vi.stubEnv("KODY_BOT_TOKEN", "bot-token");
    const { GET } = await import("../../app/api/kody/auth/me/route");

    const res = await GET(new NextRequest("https://dash.test/api/kody/auth/me"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ authenticated: false });
    expect(github.createUserOctokit).not.toHaveBeenCalled();
  });
});
