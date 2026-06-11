/**
 * @fileType utility
 * @domain terminal
 * @pattern local-chat-terminal-session
 *
 * In-process PTY sessions for the chat rail's dumb terminal mode.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { IPty } from "node-pty";

export type LocalTerminalEvent =
  | {
      id: number;
      type: "output";
      data: string;
      at: string;
    }
  | {
      id: number;
      type: "exit";
      code?: number;
      signal?: number;
      at: string;
    };

type LocalTerminalEventInput =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "exit";
      code?: number;
      signal?: number;
    };

export interface LocalTerminalSessionInfo {
  sessionId: string;
  chatSessionId?: string;
  backend: LocalTerminalBackend;
  tmuxSessionName?: string;
  owner: string;
  repo: string;
  cwd: string;
  shell: string;
  startedAt: string;
  cursor: number;
  alive: boolean;
}

interface LocalTerminalSession extends LocalTerminalSessionInfo {
  pty: IPty;
  touchedAt: number;
  nextEventId: number;
  events: LocalTerminalEvent[];
}

type LocalTerminalBackend = "pty" | "tmux";

interface LocalTerminalStore {
  sessions: Map<string, LocalTerminalSession>;
  sessionsByChatKey: Map<string, string>;
  cleanupTimer?: ReturnType<typeof setInterval>;
}

const MAX_SESSION_AGE_MS = 2 * 60 * 60_000;
const IDLE_SESSION_TIMEOUT_MS = 30 * 60_000;
const MAX_EVENTS = 800;
const MAX_EVENT_CHARS = 600_000;
const require = createRequire(import.meta.url);
let tmuxAvailableCache: boolean | null = null;

function getStore(): LocalTerminalStore {
  const globalStore = globalThis as unknown as {
    __kodyLocalTerminalStore?: LocalTerminalStore;
  };
  if (!globalStore.__kodyLocalTerminalStore) {
    globalStore.__kodyLocalTerminalStore = {
      sessions: new Map(),
      sessionsByChatKey: new Map(),
    };
  }
  globalStore.__kodyLocalTerminalStore.sessionsByChatKey ??= new Map();
  if (!globalStore.__kodyLocalTerminalStore.cleanupTimer) {
    const timer = setInterval(() => {
      cleanupLocalTerminalSessions();
    }, 60_000);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    globalStore.__kodyLocalTerminalStore.cleanupTimer = timer;
  }
  return globalStore.__kodyLocalTerminalStore;
}

function envForPty(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

function generateSessionId(): string {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function chatSessionKey(input: {
  owner: string;
  repo: string;
  chatSessionId: string;
}): string {
  return `${input.owner.toLowerCase()}/${input.repo.toLowerCase()}::${input.chatSessionId}`;
}

function isTmuxAvailable(): boolean {
  if (process.platform === "win32") return false;
  if (tmuxAvailableCache !== null) return tmuxAvailableCache;
  const result = spawnSync("tmux", ["-V"], { stdio: "ignore" });
  tmuxAvailableCache = result.status === 0;
  return tmuxAvailableCache;
}

function tmuxSessionNameForChat(input: {
  owner: string;
  repo: string;
  chatSessionId: string;
}): string {
  const digest = createHash("sha1").update(chatSessionKey(input)).digest("hex");
  return `kody_${digest.slice(0, 32)}`;
}

function hasTmuxSession(sessionName: string): boolean {
  if (!isTmuxAvailable()) return false;
  const result = spawnSync("tmux", ["has-session", "-t", sessionName], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function killTmuxSession(sessionName: string): void {
  if (!isTmuxAvailable()) return;
  spawnSync("tmux", ["kill-session", "-t", sessionName], {
    stdio: "ignore",
  });
}

function detachedTmuxSessionInfo(
  chatSessionId: string,
  auth: { owner: string; repo: string },
): LocalTerminalSessionInfo | null {
  const tmuxSessionName = tmuxSessionNameForChat({ ...auth, chatSessionId });
  if (!hasTmuxSession(tmuxSessionName)) return null;
  return {
    sessionId: `tmux-${tmuxSessionName}`,
    chatSessionId,
    backend: "tmux",
    tmuxSessionName,
    owner: auth.owner,
    repo: auth.repo,
    cwd: process.cwd(),
    shell: "tmux",
    startedAt: new Date().toISOString(),
    cursor: 0,
    alive: true,
  };
}

function ensureNodePtyHelperExecutable(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;

  try {
    const pkgPath = require.resolve("node-pty/package.json");
    const root = dirname(pkgPath);
    const candidates = [
      join(
        root,
        "prebuilds",
        `${process.platform}-${process.arch}`,
        "spawn-helper",
      ),
      join(root, "build", "Release", "spawn-helper"),
    ];
    for (const helper of candidates) {
      if (!existsSync(helper)) continue;
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0) chmodSync(helper, mode | 0o755);
    }
  } catch {
    /* node-pty will surface the spawn error if the helper is unusable */
  }
}

function pushEvent(
  session: LocalTerminalSession,
  event: LocalTerminalEventInput,
): void {
  const next = {
    ...event,
    id: session.nextEventId++,
    at: new Date().toISOString(),
  } as LocalTerminalEvent;
  session.events.push(next);
  session.cursor = next.id;
  session.touchedAt = Date.now();

  let charCount = session.events.reduce((sum, item) => {
    return sum + (item.type === "output" ? item.data.length : 0);
  }, 0);
  while (
    session.events.length > MAX_EVENTS ||
    (charCount > MAX_EVENT_CHARS && session.events.length > 1)
  ) {
    const removed = session.events.shift();
    if (removed?.type === "output") charCount -= removed.data.length;
  }
}

function closeSession(session: LocalTerminalSession): void {
  if (session.backend === "tmux" && session.tmuxSessionName) {
    killTmuxSession(session.tmuxSessionName);
  }
  if (!session.alive) return;
  session.alive = false;
  try {
    session.pty.kill();
  } catch {
    /* process may already be gone */
  }
}

function deleteSession(store: LocalTerminalStore, id: string): void {
  const session = store.sessions.get(id);
  if (session) {
    closeSession(session);
    if (session.chatSessionId) {
      store.sessionsByChatKey.delete(
        chatSessionKey({
          owner: session.owner,
          repo: session.repo,
          chatSessionId: session.chatSessionId,
        }),
      );
    }
  }
  store.sessions.delete(id);
}

export function cleanupLocalTerminalSessions(now = Date.now()): void {
  const store = getStore();
  for (const [id, session] of store.sessions) {
    const age = now - new Date(session.startedAt).getTime();
    const idle = now - session.touchedAt;
    if (age > MAX_SESSION_AGE_MS || idle > IDLE_SESSION_TIMEOUT_MS) {
      deleteSession(store, id);
    }
  }
}

export async function startLocalTerminalSession(input: {
  owner: string;
  repo: string;
  chatSessionId?: string;
  cols?: number;
  rows?: number;
}): Promise<LocalTerminalSessionInfo> {
  cleanupLocalTerminalSessions();
  const store = getStore();

  if (input.chatSessionId) {
    const key = chatSessionKey({
      owner: input.owner,
      repo: input.repo,
      chatSessionId: input.chatSessionId,
    });
    const existingId = store.sessionsByChatKey.get(key);
    const existing = existingId ? store.sessions.get(existingId) : null;
    if (existing?.alive) {
      if (input.cols && input.rows) {
        try {
          existing.pty.resize(input.cols, input.rows);
        } catch {
          /* resize failure should not force a new shell */
        }
      }
      existing.touchedAt = Date.now();
      return { ...getLocalTerminalSessionInfo(existing), cursor: 0 };
    }
    if (existingId) {
      store.sessionsByChatKey.delete(key);
      store.sessions.delete(existingId);
    }
  }

  const pty = await import("node-pty");
  ensureNodePtyHelperExecutable();
  const cwd = process.cwd();
  const defaultShell =
    process.env.SHELL ||
    (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
  const tmuxSessionName =
    input.chatSessionId && isTmuxAvailable()
      ? tmuxSessionNameForChat({
          owner: input.owner,
          repo: input.repo,
          chatSessionId: input.chatSessionId,
        })
      : undefined;
  const backend: LocalTerminalBackend = tmuxSessionName ? "tmux" : "pty";
  const shell = backend === "tmux" ? "tmux" : defaultShell;
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();
  const proc = pty.spawn(
    shell,
    tmuxSessionName
      ? ["new-session", "-A", "-s", tmuxSessionName, "-c", cwd]
      : ["-l"],
    {
      name: "xterm-256color",
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
      cwd,
      env: envForPty(),
    },
  );

  const session: LocalTerminalSession = {
    sessionId,
    chatSessionId: input.chatSessionId,
    backend,
    tmuxSessionName,
    owner: input.owner,
    repo: input.repo,
    cwd,
    shell,
    startedAt,
    cursor: 0,
    alive: true,
    pty: proc,
    touchedAt: Date.now(),
    nextEventId: 1,
    events: [],
  };

  proc.onData((data) => {
    pushEvent(session, { type: "output", data });
  });
  proc.onExit(({ exitCode, signal }) => {
    session.alive = false;
    pushEvent(session, { type: "exit", code: exitCode, signal });
  });

  store.sessions.set(sessionId, session);
  if (input.chatSessionId) {
    store.sessionsByChatKey.set(
      chatSessionKey({
        owner: input.owner,
        repo: input.repo,
        chatSessionId: input.chatSessionId,
      }),
      sessionId,
    );
  }
  return getLocalTerminalSessionInfo(session);
}

export function getLocalTerminalSessionInfo(
  session: LocalTerminalSession,
): LocalTerminalSessionInfo {
  return {
    sessionId: session.sessionId,
    chatSessionId: session.chatSessionId,
    backend: session.backend,
    tmuxSessionName: session.tmuxSessionName,
    owner: session.owner,
    repo: session.repo,
    cwd: session.cwd,
    shell: session.shell,
    startedAt: session.startedAt,
    cursor: session.cursor,
    alive: session.alive,
  };
}

export function getLocalTerminalSessionInfoByChatSession(
  chatSessionId: string,
  auth: { owner: string; repo: string },
): LocalTerminalSessionInfo | null {
  cleanupLocalTerminalSessions();
  const store = getStore();
  const sessionId = store.sessionsByChatKey.get(
    chatSessionKey({ ...auth, chatSessionId }),
  );
  if (!sessionId) {
    return detachedTmuxSessionInfo(chatSessionId, auth);
  }
  const session = store.sessions.get(sessionId);
  if (!session || session.owner !== auth.owner || session.repo !== auth.repo) {
    return detachedTmuxSessionInfo(chatSessionId, auth);
  }
  session.touchedAt = Date.now();
  if (!session.alive && session.backend === "tmux") {
    return detachedTmuxSessionInfo(chatSessionId, auth);
  }
  return getLocalTerminalSessionInfo(session);
}

export function getLocalTerminalSession(
  sessionId: string,
  auth: { owner: string; repo: string },
): LocalTerminalSession | null {
  cleanupLocalTerminalSessions();
  const session = getStore().sessions.get(sessionId);
  if (!session) return null;
  if (session.owner !== auth.owner || session.repo !== auth.repo) return null;
  session.touchedAt = Date.now();
  return session;
}

export function readLocalTerminalEvents(
  sessionId: string,
  auth: { owner: string; repo: string },
  cursor: number,
): { events: LocalTerminalEvent[]; cursor: number; alive: boolean } | null {
  const session = getLocalTerminalSession(sessionId, auth);
  if (!session) return null;
  const events = session.events.filter((event) => event.id > cursor);
  return {
    events,
    cursor: session.cursor,
    alive: session.alive,
  };
}

export function writeLocalTerminalInput(
  sessionId: string,
  auth: { owner: string; repo: string },
  input: string,
  options: { raw?: boolean } = {},
): boolean {
  const session = getLocalTerminalSession(sessionId, auth);
  if (!session || !session.alive) return false;
  if (options.raw) {
    session.pty.write(input);
    session.touchedAt = Date.now();
    return true;
  }
  session.pty.write(
    input.endsWith("\n") || input.endsWith("\r") ? input : `${input}\r`,
  );
  session.touchedAt = Date.now();
  return true;
}

export function resizeLocalTerminalSession(
  sessionId: string,
  auth: { owner: string; repo: string },
  cols: number,
  rows: number,
): boolean {
  const session = getLocalTerminalSession(sessionId, auth);
  if (!session || !session.alive) return false;
  session.pty.resize(cols, rows);
  session.touchedAt = Date.now();
  return true;
}

export function stopLocalTerminalSession(
  sessionId: string,
  auth: { owner: string; repo: string },
): boolean {
  const session = getLocalTerminalSession(sessionId, auth);
  if (!session) return false;
  deleteSession(getStore(), sessionId);
  return true;
}
