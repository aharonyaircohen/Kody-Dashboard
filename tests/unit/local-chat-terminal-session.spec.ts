import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock("node-pty", () => ({ spawn: spawnMock }));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

function makePty() {
  let dataHandler: ((data: string) => void) | undefined;
  let exitHandler:
    | ((event: { exitCode: number; signal?: number }) => void)
    | undefined;
  return {
    kill: vi.fn(),
    onData: vi.fn((callback: (data: string) => void) => {
      dataHandler = callback;
    }),
    onExit: vi.fn(
      (callback: (event: { exitCode: number; signal?: number }) => void) => {
        exitHandler = callback;
      },
    ),
    resize: vi.fn(),
    write: vi.fn(),
    emitData(data: string) {
      dataHandler?.(data);
    },
    emitExit(event: { exitCode: number; signal?: number }) {
      exitHandler?.(event);
    },
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
    const oldShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    spawnSyncMock.mockReturnValue({ status: 0 });
    try {
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
        [
          "new-session",
          "-A",
          "-s",
          session.tmuxSessionName,
          "-c",
          process.cwd(),
          "exec /bin/zsh -f",
        ],
        expect.objectContaining({ cols: 100, rows: 30 }),
      );
    } finally {
      if (oldShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = oldShell;
    }
  });

  it("starts local zsh without startup files so compinit prompts cannot block commands", async () => {
    const oldShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    try {
      const { startLocalTerminalSession } =
        await import("@dashboard/lib/terminal/local-chat-session");

      await startLocalTerminalSession({
        owner: "acme",
        repo: "widgets",
        chatSessionId: "chat-1",
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "/bin/zsh",
        ["-f"],
        expect.any(Object),
      );
    } finally {
      if (oldShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = oldShell;
    }
  });

  it("does not statically load node-pty into unrelated server bundles", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../src/dashboard/lib/terminal/local-chat-session.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain('from "node-pty"');
    expect(source).not.toContain('import("node-pty")');
    expect(source).not.toContain('require.resolve("node-pty');
  });

  it("reports local terminal unavailable when node-pty native support cannot start", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("Cannot find module './prebuilds/linux-x64//pty.node'");
    });
    const { startLocalTerminalSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    await expect(
      startLocalTerminalSession({
        owner: "acme",
        repo: "widgets",
        chatSessionId: "chat-1",
      }),
    ).rejects.toMatchObject({
      name: "LocalTerminalUnavailableError",
      code: "local_terminal_unavailable",
      message:
        "Local terminal is unavailable in this runtime because native PTY support could not load.",
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("reports local terminal unavailable when node-pty spawn returns no process", async () => {
    spawnMock.mockReturnValueOnce(undefined);
    const { LocalTerminalUnavailableError, startLocalTerminalSession } =
      await import("@dashboard/lib/terminal/local-chat-session");

    await expect(
      startLocalTerminalSession({
        owner: "acme",
        repo: "widgets",
        chatSessionId: "chat-1",
      }),
    ).rejects.toBeInstanceOf(LocalTerminalUnavailableError);
    expect(spawnMock).toHaveBeenCalledTimes(1);
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

  it("normalizes multiline command input into terminal Enter presses", async () => {
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    const { startLocalTerminalSession, writeLocalTerminalInput } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const session = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
    });

    expect(
      writeLocalTerminalInput(
        session.sessionId,
        { owner: "acme", repo: "widgets" },
        "echo one\necho two\n",
      ),
    ).toBe(true);
    expect(pty.write).toHaveBeenCalledWith("echo one\recho two\r");
  });

  it("leaves raw terminal input untouched", async () => {
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    const { startLocalTerminalSession, writeLocalTerminalInput } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const session = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
    });

    writeLocalTerminalInput(
      session.sessionId,
      { owner: "acme", repo: "widgets" },
      "echo one\n",
      { raw: true },
    );

    expect(pty.write).toHaveBeenCalledWith("echo one\n");
  });

  it("wakes a waiting output read when terminal data arrives", async () => {
    const pty = makePty();
    spawnMock.mockReturnValueOnce(pty);
    const { startLocalTerminalSession, waitForLocalTerminalEvents } =
      await import("@dashboard/lib/terminal/local-chat-session");

    const session = await startLocalTerminalSession({
      owner: "acme",
      repo: "widgets",
      chatSessionId: "chat-1",
    });

    const waiting = waitForLocalTerminalEvents(
      session.sessionId,
      { owner: "acme", repo: "widgets" },
      0,
      { timeoutMs: 1000 },
    );
    pty.emitData("typed");

    await expect(waiting).resolves.toMatchObject({
      cursor: 1,
      alive: true,
      events: [{ id: 1, type: "output", data: "typed" }],
    });
  });
});
