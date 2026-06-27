import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: mocks.requireKodyAuth,
  getRequestAuth: mocks.getRequestAuth,
}));

import { GET } from "../../app/api/kody/previews/ticket/route";
import {
  verifyBranchPreviewTicket,
  verifyPreviewTicket,
} from "@dashboard/lib/preview-token";

describe("GET /api/kody/previews/ticket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KODY_MASTER_KEY = "test-master-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    mocks.requireKodyAuth.mockResolvedValue(null);
    mocks.getRequestAuth.mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "github-token",
    });
  });

  it("mints a branch ticket for the authenticated repo", async () => {
    const res = await GET(
      new NextRequest(
        "https://dash.test/api/kody/previews/ticket?repo=owner/repo&branch=dev",
      ),
    );
    const body = (await res.json()) as {
      ticket: string;
      expiresAt: number;
      url: string;
    };

    expect(res.status).toBe(200);
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(body.url).toContain(".fly.dev/?kp=");
    expect(verifyBranchPreviewTicket(body.ticket, "owner/repo", "dev")).toBe(
      true,
    );
    expect(new URL(body.url).searchParams.get("kp")).toBe(body.ticket);
  });

  it("keeps PR ticket behavior intact", async () => {
    const res = await GET(
      new NextRequest(
        "https://dash.test/api/kody/previews/ticket?repo=owner/repo&pr=42",
      ),
    );
    const body = (await res.json()) as { ticket: string; url: string };

    expect(res.status).toBe(200);
    expect(body.url).toContain(".fly.dev/?kp=");
    expect(verifyPreviewTicket(body.ticket, "owner/repo", 42)).toBe(true);
  });

  it("rejects token requests for a different repo", async () => {
    const res = await GET(
      new NextRequest(
        "https://dash.test/api/kody/previews/ticket?repo=other/repo&branch=dev",
      ),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "repo_mismatch" });
  });

  it("requires exactly one preview identity", async () => {
    const res = await GET(
      new NextRequest(
        "https://dash.test/api/kody/previews/ticket?repo=owner/repo&pr=42&branch=dev",
      ),
    );

    expect(res.status).toBe(400);
  });
});
