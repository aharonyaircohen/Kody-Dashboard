/**
 * @fileoverview Integration coverage for Brain image save route start.
 * @testFramework vitest
 * @domain brain
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteImage: vi.fn(),
  getJob: vi.fn(),
  readImage: vi.fn(),
  readRuntimeView: vi.fn(),
  readSave: vi.fn(),
  selectRuntimeImage: vi.fn(),
  selectImage: vi.fn(),
  startJob: vi.fn(),
  clearSave: vi.fn(),
  writeImage: vi.fn(),
  writeSave: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
      account: "aguyaharonyair",
      githubToken: "gh-token",
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      allSecrets: {},
      engineModel: undefined,
    },
  })),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/brain/service-resolver", () => ({
  resolveBrainService: vi.fn(async () => ({
    app: "brain-1",
    orgSlug: "guy-koren",
    defaultRegion: "fra",
    state: "running",
    url: "https://brain-1.fly.dev",
    machineId: "machine-1",
    stored: null,
  })),
}));

vi.mock("@dashboard/lib/runners/brain-fly", () => ({
  DEFAULT_IMAGE: "ghcr.io/aharonyaircohen/kody-brain:latest",
  waitForBrainHealth: vi.fn(async () => undefined),
}));

vi.mock("@dashboard/lib/terminal/bridge-fly", () => ({
  ensureTerminalBridge: vi.fn(async () => ({
    app: "kody-terminal-guy-koren",
    url: "https://bridge.test",
    machineId: "bridge-1",
    secret: "bridge-secret",
  })),
}));

vi.mock("@dashboard/lib/terminal/bridge-exec-client", () => ({
  startTerminalBridgeLocalExecJob: mocks.startJob,
  getTerminalBridgeExecJob: mocks.getJob,
}));

vi.mock("@dashboard/lib/brain/store", () => ({
  deleteBrainImage: mocks.deleteImage,
  readBrainImage: mocks.readImage,
  readBrainImageSave: mocks.readSave,
  selectBrainImage: mocks.selectImage,
  writeBrainImage: mocks.writeImage,
  writeBrainImageSave: mocks.writeSave,
  clearBrainImageSave: mocks.clearSave,
}));

vi.mock("@dashboard/lib/brain/runtime-manager", () => ({
  readBrainRuntimeView: mocks.readRuntimeView,
  selectBrainRuntimeImage: mocks.selectRuntimeImage,
}));

vi.mock("@dashboard/lib/brain/image-runtime", () => ({
  brainGhcrAuth: vi.fn(() => ({ token: "ghcr-token", user: "aguyaharonyair" })),
}));

import { DELETE, GET, PATCH, POST } from "../../app/api/kody/brain/image/route";
import { resolveBrainService } from "../../src/dashboard/lib/brain/service-resolver";

function request(
  method: "DELETE" | "GET" | "PATCH" | "POST" = "POST",
  url = "https://dash.test/api/kody/brain/image",
  body: unknown = { app: "stale-app", machineId: "stale-machine" },
): NextRequest {
  return new NextRequest(url, {
    method,
    body:
      method === "POST" || method === "PATCH"
        ? JSON.stringify(body)
        : undefined,
  });
}

describe("GET /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSave.mockResolvedValue(null);
    mocks.readRuntimeView.mockResolvedValue({
      desiredImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      source: "runtime",
    });
    mocks.selectRuntimeImage.mockResolvedValue(undefined);
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
    });
  });

  it("includes historical Brain image tags from the GHCR package", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T10:10:10.000Z",
              updated_at: "2026-07-02T10:10:10.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-101010", "brain-20260701-090000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as {
      images?: Array<{ imageRef: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.images?.map((image) => image.imageRef)).toEqual([
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
    ]);
  });

  it("does not rediscover forgotten GHCR image tags", async () => {
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
      forgottenImageRefs: [
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T10:10:10.000Z",
              updated_at: "2026-07-02T10:10:10.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-101010", "brain-20260701-090000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as {
      images?: Array<{ imageRef: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.images?.map((image) => image.imageRef)).toEqual([
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
    ]);
  });

  it("keeps forgotten image tags hidden when a new save completes", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
      forgottenImageRefs: [
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-100000",
      ],
    });
    mocks.getJob.mockResolvedValue({
      id: "0123456789abcdef0123456789abcdef",
      status: "completed",
      startedAt: "2026-07-02T12:00:00.000Z",
      finishedAt: "2026-07-02T12:05:00.000Z",
      code: 0,
      stdout:
        "__KODY_BRAIN_IMAGE_REF=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000\n",
      stderr: "",
      error: null,
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );

    expect(res.status).toBe(200);
    expect(mocks.writeImage).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      expect.objectContaining({
        forgottenImageRefs: [
          "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
          "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-100000",
        ],
      }),
    );
    expect(mocks.writeImage.mock.calls[0]?.[2]).not.toHaveProperty("imageRef");
    expect(mocks.clearSave).toHaveBeenCalledWith("aguyaharonyair", "gh-token");
  });

  it("returns and persists running save phase progress", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.getJob.mockResolvedValue({
      id: "0123456789abcdef0123456789abcdef",
      status: "running",
      startedAt: "2026-07-02T12:00:00.000Z",
      finishedAt: null,
      code: null,
      stdout: "__KODY_BRAIN_SAVE_STAGE=push-ghcr\n",
      stderr: "pushing layer\n",
      error: null,
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = (await res.json()) as {
      phase?: string;
      message?: string;
      lastOutput?: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      lastOutput: "pushing layer",
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      expect.objectContaining({
        phase: "pushing-image",
        message: "Pushing the Brain image to GHCR",
        lastOutput: "pushing layer",
      }),
    );
  });

  it("completes a running save when the expected GHCR image already exists", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T12:05:00.000Z",
              updated_at: "2026-07-02T12:05:00.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-120000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      imageRef?: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
    });
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.writeImage).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      expect.not.objectContaining({ imageRef: expect.any(String) }),
    );
    expect(mocks.selectRuntimeImage).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
    );
    expect(mocks.clearSave).toHaveBeenCalledWith("aguyaharonyair", "gh-token");
  });
});

describe("DELETE /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readRuntimeView.mockResolvedValue({ source: "empty" });
    mocks.deleteImage.mockResolvedValue({
      version: 1,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [],
      forgottenImageRefs: [
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ],
    });
  });

  it("forgets the requested Brain image for the current user", async () => {
    const res = await DELETE(
      request(
        "DELETE",
        "https://dash.test/api/kody/brain/image?imageRef=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ),
    );

    expect(res.status).toBe(200);
    expect(mocks.deleteImage).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
    );
  });
});

describe("PATCH /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readRuntimeView.mockResolvedValue({
      desiredImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
      source: "runtime",
    });
    mocks.selectRuntimeImage.mockResolvedValue(undefined);
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
        {
          imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    mocks.selectImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
    });
  });

  it("selects the desired runtime image without mutating catalog metadata", async () => {
    const res = await PATCH(
      request("PATCH", "https://dash.test/api/kody/brain/image", {
        imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.selectImage).not.toHaveBeenCalled();
    expect(mocks.selectRuntimeImage).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
    );
    expect(mocks.startJob).not.toHaveBeenCalled();
  });
});

describe("POST /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readImage.mockResolvedValue(null);
    mocks.readSave.mockResolvedValue(null);
    mocks.selectImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:selected",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
      images: [],
    });
    mocks.startJob.mockResolvedValue({
      id: "job-1",
      status: "running",
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      stdout: "",
      stderr: "",
      error: null,
    });
  });

  it("starts a save job against the resolved Brain org, not stale client input", async () => {
    const res = await POST(request());
    const body = (await res.json()) as { status?: string; jobId?: string };

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ status: "running", jobId: "job-1" });
    const command = mocks.startJob.mock.calls[0]?.[0]?.command as string;
    expect(command).toContain("app='\\''brain-1'\\''");
    expect(command).toContain("machine='\\''machine-1'\\''");
    expect(command).toContain("org='\\''guy-koren'\\''");
    expect(command).toContain('--org "$org"');
    expect(command).not.toContain("stale-app");
    expect(command).not.toContain("stale-machine");
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "aguyaharonyair",
      "gh-token",
      expect.objectContaining({
        status: "running",
        jobId: "job-1",
        app: "brain-1",
        machineId: "machine-1",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("returns a Fly authorization error before starting a save job", async () => {
    vi.mocked(resolveBrainService).mockResolvedValueOnce({
      app: "brain-1",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      flyToken: "fly-token",
      state: "off",
      stored: {
        version: 1,
        appName: "brain-1",
        orgSlug: "guy-koren",
        createdAt: "2026-07-06T10:00:00.000Z",
      },
      reason: "fly_access_denied",
    });

    const res = await POST(request());
    const body = (await res.json()) as {
      error?: string;
      message?: string;
    };

    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      error: "fly_access_denied",
      message: "Fly token cannot access this Brain app.",
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
  });
});
