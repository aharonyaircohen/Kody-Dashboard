/**
 * @fileoverview Integration coverage for terminal checkpoint API routes.
 * @testFramework vitest
 * @domain terminal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  })),
  getUserOctokit: vi.fn(async () => ({ marker: "octokit" })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", avatar_url: "", githubId: 1 },
  })),
}));

const checkpointStore = vi.hoisted(() => ({
  deleteTerminalCheckpoint: vi.fn(),
  getTerminalCheckpoint: vi.fn(),
  upsertTerminalCheckpoint: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/terminal/checkpoint-store", () => checkpointStore);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  DELETE,
  GET,
  PUT,
} from "../../app/api/kody/chat/terminal/checkpoint/route";

const localTransport = { type: "local" as const };

function checkpointUrl(actorLogin = "alice", transport = localTransport) {
  const params = new URLSearchParams({
    actorLogin,
    chatSessionId: "chat-1",
    transport: JSON.stringify(transport),
  });
  return `https://dash.test/api/kody/chat/terminal/checkpoint?${params.toString()}`;
}

function getReq(actorLogin = "alice"): NextRequest {
  return new NextRequest(checkpointUrl(actorLogin));
}

function putReq(body: unknown): NextRequest {
  return new NextRequest(
    "https://dash.test/api/kody/chat/terminal/checkpoint",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function deleteReq(actorLogin = "alice"): NextRequest {
  return new NextRequest(checkpointUrl(actorLogin), { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  });
  auth.getUserOctokit.mockResolvedValue({ marker: "octokit" });
  auth.verifyActorLogin.mockResolvedValue({
    identity: { login: "alice", avatar_url: "", githubId: 1 },
  });
  checkpointStore.getTerminalCheckpoint.mockResolvedValue({
    doc: { version: 1, checkpoints: [] },
    checkpoint: null,
    sha: "sha-1",
  });
  checkpointStore.upsertTerminalCheckpoint.mockResolvedValue({
    doc: { version: 1, checkpoints: [] },
    checkpoint: {
      id: "checkpoint-1",
      key: "local:chat-1",
      transport: localTransport,
      chatSessionId: "chat-1",
      output: "ready",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      savedBy: "alice",
    },
    sha: "sha-2",
  });
  checkpointStore.deleteTerminalCheckpoint.mockResolvedValue({
    doc: { version: 1, checkpoints: [] },
    deleted: { id: "checkpoint-1" },
    sha: "sha-2",
  });
});

describe("terminal checkpoint routes", () => {
  it("reads the current checkpoint for the verified actor", async () => {
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ checkpoint: null });
    expect(auth.verifyActorLogin).toHaveBeenCalledWith(
      expect.anything(),
      "alice",
    );
    expect(checkpointStore.getTerminalCheckpoint).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
      expect.objectContaining({
        chatSessionId: "chat-1",
        transport: localTransport,
      }),
    );
  });

  it("saves the current terminal checkpoint without a user-provided name", async () => {
    const res = await PUT(
      putReq({
        actorLogin: "alice",
        transport: {
          type: "fly",
          app: "brain",
          machineId: "m1",
          feature: "brain",
        },
        chatSessionId: "chat-1",
        cwd: "/repo",
        shell: "zsh",
        output: "ready",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      checkpoint: { id: "checkpoint-1" },
    });
    expect(checkpointStore.upsertTerminalCheckpoint).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
      expect.objectContaining({
        chatSessionId: "chat-1",
        transport: expect.objectContaining({ feature: "brain" }),
      }),
    );
  });

  it("rejects invalid checkpoint payloads", async () => {
    const res = await PUT(
      putReq({
        actorLogin: "alice",
        transport: { type: "fly", app: "", machineId: "" },
        chatSessionId: "",
      }),
    );

    expect(res.status).toBe(400);
    expect(checkpointStore.upsertTerminalCheckpoint).not.toHaveBeenCalled();
  });

  it("resets the current checkpoint for the verified actor", async () => {
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(checkpointStore.deleteTerminalCheckpoint).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
      expect.objectContaining({
        chatSessionId: "chat-1",
        transport: localTransport,
      }),
    );
  });
});
