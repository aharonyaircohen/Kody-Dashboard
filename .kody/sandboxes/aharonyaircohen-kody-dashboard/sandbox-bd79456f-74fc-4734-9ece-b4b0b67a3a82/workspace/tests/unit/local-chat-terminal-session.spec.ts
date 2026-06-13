import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

function makePty() {
  return {
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  };
}

describe("local chat terminal session registry", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 1 });
    (
      globalThis as { __kodyLocalTerminalStore?: unknown }
    ).__kodyLocalTerminalStore = undefined;
  });

  it("reuses the live local terminal for the same chat session", async () => {
    const firstPty = makePty();
    spawnMock.mockReturnValueOnce(firstPty);
    const { startLocalTerminalSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const first = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
      cols: 100,
      rows: 30,
    });
    const second = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
      cols: 120,
      rows: 32,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.cursor).toBe(0);
    expect(firstPty.resize).toHaveBeenCalledWith(120, 32);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new local terminal after an explicit stop", async () => {
    spawnMock.mockReturnValueOnce(makePty()).mockReturnValueOnce(makePty());
    const { startLocalTerminalSession, stopLocalTerminalSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const first = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
    });

    expect(
      stopLocalTerminalSession(first.sessionId, {
        owner: "acme",
        repo: "widgets",
      }),
    ).toBe(true);

    const second = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
    });

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("uses a tmux attachment when tmux is available", async () => {
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    spawnSyncMock.mockReturnValue({ status: 0 });
    const { startLocalTerminalSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const session = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
      cols: 100,
      rows: 30,
    });

    expect(session.backend).toBe("tmux");
    expect(session.tmuxSessionName).toMatch(/^kody_[a-f0-9]{32}$/);
    expect(spawnMock).toHaveBeenCalledWith(
      "tmux",
      ["new-session", "-A", "-s", session.tmuxSessionName, "-c", process.cwd()],
      expect.objectContaining({ cols: 100, rows: 30 }),
    );
  });

  it("reports a detached tmux session after process memory is gone", async () => {
    spawnSyncMock.mockImplementation(
      (_command: string, args: string[] | undefined) => {
        if (args?.[0] === "-V") return { status: 0 };
        if (args?.[0] === "has-session") return { status: 0 };
        return { status: 1 };
      },
    );
    const { getLocalTerminalSessionInfoByChatSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const session = getLocalTerminalSessionInfoByChatSession("chat-1", {
      owner: "acme",
      repo: "widgets",
    });

    expect(session).toMatchObject({
      backend: "tmux",
      chatSessionId: "chat-1",
      alive: true,
      shell: "tmux",
    });
  });
});
