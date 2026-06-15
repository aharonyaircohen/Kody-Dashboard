import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/kody/views/[...path]/route";
import { mintRepoViewToken } from "@dashboard/lib/view-token";

const ORIGINAL_MASTER_KEY = process.env.KODY_MASTER_KEY;

function mintTicket(viewId = "pdf-f7fef487"): string {
  return mintRepoViewToken({
    owner: "octo",
    repo: "repo",
    viewId,
    githubToken: "ghs_test_token",
    ttlSeconds: 60,
  }).token;
}

beforeEach(() => {
  process.env.KODY_MASTER_KEY = "test-master-key";
});

afterEach(() => {
  if (ORIGINAL_MASTER_KEY) {
    process.env.KODY_MASTER_KEY = ORIGINAL_MASTER_KEY;
  } else {
    delete process.env.KODY_MASTER_KEY;
  }
  vi.restoreAllMocks();
});

describe("repo-backed view serving", () => {
  it("serves direct PDF URLs as inline PDF bytes", async () => {
    const token = mintTicket();
    const pdf = Buffer.from("%PDF-1.4\nbody");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdf, {
        status: 200,
        headers: { "Content-Type": "application/vnd.github.raw+json" },
      }),
    );
    const req = new NextRequest(
      `http://localhost/api/kody/views/_t/${token}/pdf-f7fef487/-_-.pdf`,
    );

    const res = await GET(req, {
      params: Promise.resolve({
        path: ["_t", token, "pdf-f7fef487", "-_-.pdf"],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="-_-.pdf"',
    );
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(
      "%PDF-1.4\nbody",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octo/repo/contents/.kody/views/pdf-f7fef487/-_-.pdf",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer ghs_test_token",
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
      }),
    );
  });

  it("maps missing GitHub content to view_file_not_found", async () => {
    const token = mintTicket("view-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 404 }),
    );
    const req = new NextRequest(
      `http://localhost/api/kody/views/_t/${token}/view-123/index.html`,
    );

    const res = await GET(req, {
      params: Promise.resolve({
        path: ["_t", token, "view-123", "index.html"],
      }),
    });

    await expect(res.json()).resolves.toEqual({ error: "view_file_not_found" });
    expect(res.status).toBe(404);
  });
});
