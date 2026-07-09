import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  listBrands: vi.fn(),
  readBrandFile: vi.fn(),
  writeBrandFile: vi.fn(),
  deleteBrandFile: vi.fn(),
  disableBrand: vi.fn(),
  isBrandDeleted: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

vi.mock("@dashboard/lib/brands", () => ({
  listBrands: h.listBrands,
  readBrandFile: h.readBrandFile,
  writeBrandFile: h.writeBrandFile,
  deleteBrandFile: h.deleteBrandFile,
  disableBrand: h.disableBrand,
  isBrandDeleted: h.isBrandDeleted,
  isValidBrandSlug: (slug: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { GET as GET_LIST, POST } from "../../app/api/kody/brands/route";
import {
  DELETE,
  GET as GET_ONE,
  PATCH,
} from "../../app/api/kody/brands/[slug]/route";

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function req(path: string, init?: NextRequestInit) {
  return new NextRequest(`http://localhost${path}`, init);
}

function params(slug = "acme") {
  return { params: Promise.resolve({ slug }) };
}

describe("brands API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({
      identity: { login: "alice", githubId: 1, avatarUrl: "" },
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test",
      owner: "acme",
      repo: "widgets",
    });
    h.isBrandDeleted.mockResolvedValue(false);
  });

  it("lists brands", async () => {
    h.listBrands.mockResolvedValue([{ slug: "kody", name: "Kody" }]);

    const res = await GET_LIST(req("/api/kody/brands"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      brands: [{ slug: "kody", name: "Kody" }],
    });
  });

  it("creates a repo brand with actor verification", async () => {
    h.readBrandFile.mockResolvedValue(null);
    h.writeBrandFile.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#2563eb",
    });

    const res = await POST(
      req("/api/kody/brands", {
        method: "POST",
        body: JSON.stringify({
          slug: "Acme",
          name: "Acme",
          accent: "#2563eb",
          modelId: "sonnet-4",
          agentSlug: "qa-agent",
          actorLogin: "alice",
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      brand: { slug: "acme", name: "Acme", accent: "#2563eb" },
    });
    expect(h.verifyActorLogin).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "alice",
    );
    expect(h.writeBrandFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "acme",
        modelId: "sonnet-4",
        agentSlug: "qa-agent",
      }),
    );
  });

  it("rejects invalid brand input", async () => {
    const res = await POST(
      req("/api/kody/brands", {
        method: "POST",
        body: JSON.stringify({
          slug: "acme",
          name: "",
          accent: "blue",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(h.writeBrandFile).not.toHaveBeenCalled();
  });

  it("updates an existing brand", async () => {
    h.readBrandFile.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#2563eb",
      locale: "en",
      welcomeText: "",
      modelId: "old-model",
      agentSlug: "old-agent",
      sha: "sha",
    });
    h.writeBrandFile.mockResolvedValue({
      slug: "acme",
      name: "Acme Support",
      accent: "#2563eb",
    });

    const res = await PATCH(
      req("/api/kody/brands/acme", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Acme Support",
          modelId: "sonnet-4",
          agentSlug: "qa-agent",
          actorLogin: "alice",
        }),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(h.writeBrandFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "acme",
        name: "Acme Support",
        modelId: "sonnet-4",
        agentSlug: "qa-agent",
        sha: "sha",
      }),
    );
  });

  it("returns a fallback brand when no repo brand exists", async () => {
    h.readBrandFile.mockResolvedValue(null);

    const res = await GET_ONE(req("/api/kody/brands/acme"), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      brand: expect.objectContaining({
        slug: "acme",
        name: "Acme",
        source: "builtin",
      }),
    });
  });

  it("returns 404 for an unknown brand detail slug", async () => {
    h.readBrandFile.mockResolvedValue(null);

    const res = await GET_ONE(
      req("/api/kody/brands/unknown-brand"),
      params("unknown-brand"),
    );

    expect(res.status).toBe(404);
  });

  it("does not PATCH-create an unknown brand slug", async () => {
    h.readBrandFile.mockResolvedValue(null);

    const res = await PATCH(
      req("/api/kody/brands/unknown-brand", {
        method: "PATCH",
        body: JSON.stringify({ name: "Unknown", actorLogin: "alice" }),
      }),
      params("unknown-brand"),
    );

    expect(res.status).toBe(404);
    expect(h.writeBrandFile).not.toHaveBeenCalled();
  });

  it("deletes a repo-only brand", async () => {
    h.readBrandFile.mockResolvedValue({ slug: "custom", sha: "sha" });

    const res = await DELETE(
      req("/api/kody/brands/custom?actorLogin=alice", { method: "DELETE" }),
      params("custom"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteBrandFile).toHaveBeenCalledWith({ rest: {} }, "custom");
    expect(h.disableBrand).not.toHaveBeenCalled();
  });

  it("deletes a built-in fallback brand with a repo marker", async () => {
    h.readBrandFile.mockResolvedValue(null);

    const res = await DELETE(
      req("/api/kody/brands/acme?actorLogin=alice", { method: "DELETE" }),
      params(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteBrandFile).not.toHaveBeenCalled();
    expect(h.disableBrand).toHaveBeenCalledWith({ rest: {} }, "acme");
  });

  it("deletes a repo override for a built-in and keeps fallback hidden", async () => {
    h.readBrandFile.mockResolvedValue({ slug: "acme", sha: "sha" });

    const res = await DELETE(
      req("/api/kody/brands/acme?actorLogin=alice", { method: "DELETE" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(h.deleteBrandFile).toHaveBeenCalledWith({ rest: {} }, "acme");
    expect(h.disableBrand).toHaveBeenCalledWith({ rest: {} }, "acme");
  });
});
