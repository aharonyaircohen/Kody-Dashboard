/**
 * Unit tests for KodyChat's localStorage-backed live-session persistence +
 * auth-header helpers (extracted from KodyChat.tsx).
 *
 * vitest runs in node, so each test installs a Map-backed fake on BOTH
 * `globalThis.window.localStorage` (used by this module) and
 * `globalThis.localStorage` (used by getStoredAuth in ../api).
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  authHeaders,
  brainHeaders,
  clearLiveSession,
  getLiveScopeKey,
  liveAuthFor,
  liveAuthHeaders,
  loadLiveSession,
  saveLiveSession,
  stickyBrainChatId,
  type PersistedLiveSession,
} from "@dashboard/lib/components/kody-chat-live-session";
import type { ChatContext } from "@dashboard/lib/chat-types";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function installStorage(auth?: object): MemStorage {
  const store = new MemStorage();
  if (auth) store.setItem("kody_auth", JSON.stringify(auth));
  (globalThis as { window?: unknown }).window = { localStorage: store };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const rec = (
  over: Partial<PersistedLiveSession> = {},
): PersistedLiveSession => ({
  sessionId: "sess-1",
  state: "ready",
  startedAt: Date.now(),
  ...over,
});

describe("getLiveScopeKey", () => {
  it("is 'global' outside vibe mode", () => {
    expect(getLiveScopeKey(null, false)).toBe("global");
    expect(getLiveScopeKey(undefined, undefined)).toBe("global");
  });

  it("is 'vibe-default' in vibe mode with no task", () => {
    expect(getLiveScopeKey(null, true)).toBe("vibe-default");
  });

  it("is scoped per issue in vibe mode with a task context", () => {
    const ctx = {
      kind: "task",
      task: { issueNumber: 42 },
    } as unknown as ChatContext;
    expect(getLiveScopeKey(ctx, true)).toBe("vibe-42");
  });
});

describe("save / load / clear", () => {
  beforeEach(() => installStorage());

  it("round-trips a record under its scope key", () => {
    saveLiveSession("global", rec({ sessionId: "abc" }));
    expect(loadLiveSession("global")?.sessionId).toBe("abc");
  });

  it("returns null for an unknown scope", () => {
    expect(loadLiveSession("vibe-9")).toBeNull();
  });

  it("clears one scope without touching the others", () => {
    saveLiveSession("global", rec({ sessionId: "g" }));
    saveLiveSession("vibe-1", rec({ sessionId: "v" }));
    clearLiveSession("global");
    expect(loadLiveSession("global")).toBeNull();
    expect(loadLiveSession("vibe-1")?.sessionId).toBe("v");
  });
});

describe("per-repo scoping", () => {
  it("isolates sessions stored under different connected repos", () => {
    installStorage({ owner: "Acme", repo: "RepoA", token: "t" });
    saveLiveSession("global", rec({ sessionId: "a" }));
    // Switch connected repo; the scoped key changes, so the old record is invisible.
    installStorage({ owner: "Acme", repo: "RepoB", token: "t" });
    expect(loadLiveSession("global")).toBeNull();
    saveLiveSession("global", rec({ sessionId: "b" }));
    expect(loadLiveSession("global")?.sessionId).toBe("b");
  });
});

describe("pruning on read", () => {
  beforeEach(() => installStorage());

  it("drops records older than the 35-minute cap", () => {
    saveLiveSession("global", rec({ startedAt: Date.now() - 36 * 60_000 }));
    expect(loadLiveSession("global")).toBeNull();
  });

  it("keeps fresh records", () => {
    saveLiveSession("global", rec({ startedAt: Date.now() - 60_000 }));
    expect(loadLiveSession("global")).not.toBeNull();
  });

  it("drops malformed records (no sessionId)", () => {
    const store = installStorage();
    store.setItem(
      "kody-live-sessions",
      JSON.stringify({ global: { state: "ready", startedAt: Date.now() } }),
    );
    expect(loadLiveSession("global")).toBeNull();
  });
});

describe("legacy single-record migration", () => {
  it("adopts a legacy kody-live-session record under 'global'", () => {
    const store = installStorage();
    store.setItem(
      "kody-live-session",
      JSON.stringify(rec({ sessionId: "legacy" })),
    );
    expect(loadLiveSession("global")?.sessionId).toBe("legacy");
    // Legacy key is consumed by the migration.
    expect(store.getItem("kody-live-session")).toBeNull();
  });
});

describe("liveAuthFor", () => {
  it("returns null when no auth is stored", () => {
    installStorage();
    expect(liveAuthFor("sess-x")).toBeNull();
  });

  it("returns the plain auth when the session has no pinned target", () => {
    installStorage({ owner: "o", repo: "r", token: "tok" });
    expect(liveAuthFor("unknown")).toEqual({
      owner: "o",
      repo: "r",
      token: "tok",
    });
  });

  it("overrides owner/repo with the session's pinned dispatch target", () => {
    installStorage({ owner: "o", repo: "r", token: "tok" });
    saveLiveSession(
      "global",
      rec({
        sessionId: "pinned",
        target: { owner: "engine-o", repo: "engine-r" },
      }),
    );
    expect(liveAuthFor("pinned")).toEqual({
      owner: "engine-o",
      repo: "engine-r",
      token: "tok",
    });
  });
});

describe("header builders", () => {
  it("authHeaders emits x-kody-* from stored auth (empty when none)", () => {
    installStorage();
    expect(authHeaders()).toEqual({});
    installStorage({ owner: "o", repo: "r", token: "tok" });
    expect(authHeaders()).toEqual({
      "x-kody-token": "tok",
      "x-kody-owner": "o",
      "x-kody-repo": "r",
    });
  });

  it("liveAuthHeaders folds in the pinned target", () => {
    installStorage({ owner: "o", repo: "r", token: "tok" });
    saveLiveSession(
      "global",
      rec({ sessionId: "s", target: { owner: "eo", repo: "er" } }),
    );
    expect(liveAuthHeaders("s")).toEqual({
      "x-kody-token": "tok",
      "x-kody-owner": "eo",
      "x-kody-repo": "er",
    });
  });

  it("brainHeaders emits x-brain-* only when brain config is stored", () => {
    installStorage();
    expect(brainHeaders()).toEqual({});
    installStorage({ brain: { url: "https://brain.test", apiKey: "k" } });
    expect(brainHeaders()).toEqual({
      "x-brain-url": "https://brain.test",
      "x-brain-key": "k",
    });
  });
});

describe("stickyBrainChatId", () => {
  beforeEach(() => installStorage());

  it("pins the first candidate for a logical key and reuses it", () => {
    expect(stickyBrainChatId("conv-1", "first")).toBe("first");
    // A later turn proposes a different id — the pinned one wins.
    expect(stickyBrainChatId("conv-1", "second")).toBe("first");
  });

  it("pins independently per logical key", () => {
    expect(stickyBrainChatId("conv-a", "a")).toBe("a");
    expect(stickyBrainChatId("conv-b", "b")).toBe("b");
  });
});
