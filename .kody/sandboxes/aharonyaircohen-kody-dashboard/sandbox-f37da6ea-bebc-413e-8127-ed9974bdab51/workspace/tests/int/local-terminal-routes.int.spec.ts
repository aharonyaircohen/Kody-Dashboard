/**
 * @fileoverview Integration coverage for local chat terminal API routes.
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
}));

const localTerminal = vi.hoisted(() => ({
  startLocalTerminalSession: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/terminal/local-chat-session", () => localTerminal);

import { POST as startPOST } from "../../app/api/kody/chat/terminal/start/route";

function makeStartReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/terminal/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  });
  localTerminal.startLocalTerminalSession.mockResolvedValue({
    sessionId: "terminal-chat-1",
    chatSessionId: "chat-1",
    backend: "pty",
    owner: "acme",
    repo: "widgets",
    cwd: "/workspace/acme/widgets",
    shell: "zsh",
    startedAt: "2026-06-11T00:00:00.000Z",
    cursor: 0,
    alive: true,
  });
});

describe("POST /api/kody/chat/terminal/start", () => {
  it("starts a chat-scoped local terminal session", async () => {
    const res = await startPOST(
      makeStartReq({ chatSessionId: "chat-1", cols: 132, rows: 40 }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      session: {
        sessionId: "terminal-chat-1",
        chatSessionId: "chat-1",
        alive: true,
      },
    });
    expect(localTerminal.startLocalTerminalSession).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
      cols: 132,
      rows: 40,
    });
  });

  it("rejects invalid terminal dimensions", async () => {
    const res = await startPOST(makeStartReq({ cols: 1, rows: 1 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
    expect(localTerminal.startLocalTerminalSession).not.toHaveBeenCalled();
  });

  it("returns a controlled error when the local terminal cannot start", async () => {
    localTerminal.startLocalTerminalSession.mockRejectedValueOnce(
      new Error("node-pty unavailable"),
    );

    const res = await startPOST(makeStartReq({ chatSessionId: "chat-1" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "terminal_start_failed",
      message: "node-pty unavailable",
    });
  });
});
