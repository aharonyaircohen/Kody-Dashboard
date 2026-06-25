/**
 * @fileoverview Integration coverage for saved terminal snapshot API routes.
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

const savedStore = vi.hoisted(() => ({
  deleteSavedTerminalSession: vi.fn(),
  readSavedTerminalSessions: vi.fn(),
  upsertSavedTerminalSession: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/terminal/saved-session-store", () => savedStore);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  GET as listGET,
  POST as savePOST,
} from "../../app/api/kody/chat/terminal/saved/route";
import { DELETE as deleteDELETE } from "../../app/api/kody/chat/terminal/saved/[id]/route";

function listReq(actorLogin = "alice"): NextRequest {
  return new NextRequest(
    `https://dash.test/api/kody/chat/terminal/saved?actorLogin=${actorLogin}`,
  );
}

function saveReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/terminal/saved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq(actorLogin = "alice"): NextRequest {
  return new NextRequest(
    `https://dash.test/api/kody/chat/terminal/saved/saved-1?actorLogin=${actorLogin}`,
    { method: "DELETE" },
  );
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
  savedStore.readSavedTerminalSessions.mockResolvedValue({
    doc: { version: 1, sessions: [] },
    sha: "sha-1",
  });
  savedStore.upsertSavedTerminalSession.mockResolvedValue({
    doc: { version: 1, sessions: [] },
    session: {
      id: "saved-1",
      name: "Runner",
      transport: { type: "local" },
      chatSessionId: "chat-1",
      output: "",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      savedBy: "alice",
    },
    sha: "sha-2",
  });
  savedStore.deleteSavedTerminalSession.mockResolvedValue({
    doc: { version: 1, sessions: [] },
    deleted: { id: "saved-1" },
    sha: "sha-2",
  });
});

describe("saved terminal snapshot routes", () => {
  it("lists snapshots for the verified actor", async () => {
    const res = await listGET(listReq());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sessions: [] });
    expect(auth.verifyActorLogin).toHaveBeenCalledWith(
      expect.anything(),
      "alice",
    );
    expect(savedStore.readSavedTerminalSessions).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
    );
  });

  it("saves a named terminal snapshot", async () => {
    const res = await savePOST(
      saveReq({
        actorLogin: "alice",
        id: "auto-brain",
        name: "Runner",
        transport: { type: "fly", app: "runner", machineId: "m1" },
        chatSessionId: "chat-1",
        cwd: "/repo",
        shell: "zsh",
        output: "ready",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      session: { id: "saved-1", name: "Runner" },
    });
    expect(savedStore.upsertSavedTerminalSession).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
      expect.objectContaining({
        id: "auto-brain",
        name: "Runner",
        chatSessionId: "chat-1",
      }),
    );
  });

  it("rejects invalid saved terminal payloads", async () => {
    const res = await savePOST(
      saveReq({
        actorLogin: "alice",
        name: "",
        transport: { type: "fly", app: "", machineId: "" },
        chatSessionId: "",
      }),
    );

    expect(res.status).toBe(400);
    expect(savedStore.upsertSavedTerminalSession).not.toHaveBeenCalled();
  });

  it("deletes a saved snapshot for the verified actor", async () => {
    const res = await deleteDELETE(deleteReq(), {
      params: Promise.resolve({ id: "saved-1" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(savedStore.deleteSavedTerminalSession).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      "alice",
      "saved-1",
    );
  });
});
