/**
 * @fileoverview Integration coverage for chat terminal status route wiring.
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

const terminalSessions = vi.hoisted(() => ({
  getLocalTerminalSessionInfoByChatSession: vi.fn(() => ({
    sessionId: "session-1",
    alive: true,
  })),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/terminal/local-chat-session", () => terminalSessions);

import { GET } from "../../app/api/kody/chat/terminal/status/route";

function statusReq(query: string): NextRequest {
  return new NextRequest(
    `https://dash.test/api/kody/chat/terminal/status?${query}`,
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
  terminalSessions.getLocalTerminalSessionInfoByChatSession.mockReturnValue({
    sessionId: "session-1",
    alive: true,
  });
});

describe("GET /api/kody/chat/terminal/status", () => {
  it("looks up local terminal status by chat session only", async () => {
    const res = await GET(statusReq("chatSessionId=chat-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      session: { sessionId: "session-1", alive: true },
    });
    expect(
      terminalSessions.getLocalTerminalSessionInfoByChatSession,
    ).toHaveBeenCalledWith("chat-1", {
      owner: "acme",
      repo: "widgets",
      token: "ghp_test",
    });
  });
});
