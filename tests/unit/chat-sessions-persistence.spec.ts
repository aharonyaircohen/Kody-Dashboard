/**
 * Golden-fixture unit tests for chat session persistence
 * (src/dashboard/lib/chat/core/use-chat-sessions.ts + related key builders).
 *
 * Phase-1 step 0 (finding M1e/f): pin the localStorage schema, the storage
 * key strings, and the migration order so any silent format change fails
 * loudly here instead of eating user history in production.
 *
 * What exists in code (and is tested here — nothing invented):
 * - v3 scoped store:      `kody-sessions-v3:<owner>/<repo>` (lowercased)
 * - legacy unscoped v3:   `kody-sessions-v3` (adopted once, then deleted)
 * - v2 → v3 migration:    migrateFromV2 (agent-scoped → single-session)
 * - Migration order in loadStore: scoped v3 → scoped v2 (migrate in place)
 *   → legacy unscoped adoption (v3 as-is / v2 migrated), global scope only.
 *
 * vitest runs in node (no DOM): each test installs a Map-backed fake on BOTH
 * `globalThis.window.localStorage` and `globalThis.localStorage` (loadStore
 * and saveStore use the bare global). No React rendering anywhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { GlobalChatStore } from "@dashboard/lib/chat-types";
import { defaultChatEntryStorageKey } from "@dashboard/lib/chat/platform/default-entry";
import {
  saveLiveSession,
  type PersistedLiveSession,
} from "@dashboard/lib/chat/core/kody-chat-live-session";

// ─── node-env localStorage fake ──────────────────────────────────────────────

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

/**
 * Fresh module instance per test — getStorageKey keeps module-level
 * `lastKnownRepoKey` state and saveStore keeps per-key debounce maps, so
 * tests must not leak resolved repo keys or pending saves into each other.
 */
async function loadModule() {
  vi.resetModules();
  return import("@dashboard/lib/chat/core/use-chat-sessions");
}

const AUTH = { owner: "test-owner", repo: "test-repo", token: "t" };
const SCOPED_KEY = "kody-sessions-v3:test-owner/test-repo";
const LEGACY_KEY = "kody-sessions-v3";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Corrupt-payload paths are silent since the chat/core move (no-console is
  // a lint error there); the spy stays as a guard that nothing regresses to
  // logging in these paths.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// ─── Golden fixtures ─────────────────────────────────────────────────────────

/** Current v3 payload, exactly as serialized to localStorage. */
const V3_FIXTURE: GlobalChatStore = {
  version: 3,
  sessions: [
    {
      id: "1700000000000-aaaaaaa",
      title: "Fix the login bug",
      preview: "the login page 500s when…",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:05:00.000Z",
      messageCount: 2,
      pinned: true,
      agentKey: "kody-live",
    },
    {
      id: "1700000001000-bbbbbbb",
      title: "New conversation",
      createdAt: "2026-01-02T09:00:00.000Z",
      updatedAt: "2026-01-02T09:00:00.000Z",
      messageCount: 0,
      pinned: false,
    },
  ],
  messages: {
    "1700000000000-aaaaaaa": [
      {
        role: "user",
        text: "the login page 500s when I submit",
        timestamp: "2026-01-01T10:00:00.000Z",
      },
      {
        role: "assistant",
        text: "Looking into it.",
        timestamp: "2026-01-01T10:05:00.000Z",
        model: "claude",
        toolCalls: [
          {
            name: "read_file",
            arguments: { path: "app/login.tsx" },
            status: "success",
          },
        ],
      },
    ],
    "1700000001000-bbbbbbb": [],
  },
  activeSessionId: "1700000000000-aaaaaaa",
};

/**
 * Legacy v2 payload: sessions carry `agentId`, `activeSessionId` is a
 * per-agent map (not a string). Shape mirrors what migrateFromV2 consumes.
 */
const V2_FIXTURE = {
  version: 2,
  sessions: [
    {
      id: "s-kody-1",
      agentId: "kody",
      title: "Kody thread",
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:10:00.000Z",
      messageCount: 1,
      pinned: false,
    },
    {
      id: "s-brain-1",
      agentId: "brain",
      title: "Brain thread",
      createdAt: "2025-12-02T00:00:00.000Z",
      updatedAt: "2025-12-02T00:10:00.000Z",
      messageCount: 0,
      pinned: true,
    },
  ],
  messages: {
    "s-kody-1": [
      {
        role: "user",
        text: "hello from v2",
        timestamp: "2025-12-01T00:00:00.000Z",
      },
    ],
  },
  // v2 kept one active session per agent. brain's pick ("s-brain-1") has no
  // messages, kody's ("s-kody-1") does — migration must pick the non-empty one.
  activeSessionId: { brain: "s-brain-1", kody: "s-kody-1" },
} as unknown as GlobalChatStore;

/** What migrateFromV2 must produce from V2_FIXTURE (agentId dropped). */
const V2_MIGRATED: GlobalChatStore = {
  version: 3,
  sessions: [
    {
      id: "s-kody-1",
      title: "Kody thread",
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:10:00.000Z",
      messageCount: 1,
      pinned: false,
    },
    {
      id: "s-brain-1",
      title: "Brain thread",
      createdAt: "2025-12-02T00:00:00.000Z",
      updatedAt: "2025-12-02T00:10:00.000Z",
      messageCount: 0,
      pinned: true,
    },
  ],
  messages: {
    "s-kody-1": [
      {
        role: "user",
        text: "hello from v2",
        timestamp: "2025-12-01T00:00:00.000Z",
      },
    ],
    "s-brain-1": [],
  },
  activeSessionId: "s-kody-1",
};

const CORRUPT_JSON = '{"version":3,"sessions":[{"id":"trunc';

const EMPTY_STORE: GlobalChatStore = {
  version: 3,
  sessions: [],
  messages: {},
  activeSessionId: "",
};

// ─── Storage key builders (exact strings pinned) ─────────────────────────────

describe("storage keys", () => {
  it("getStorageKey('global') is exactly kody-sessions-v3:test-owner/test-repo", async () => {
    installStorage(AUTH);
    const { getStorageKey } = await loadModule();
    expect(getStorageKey("global")).toBe(
      "kody-sessions-v3:test-owner/test-repo",
    );
  });

  it("lowercases owner/repo from kody_auth", async () => {
    installStorage({ owner: "Test-Owner", repo: "Test-Repo" });
    const { getStorageKey } = await loadModule();
    expect(getStorageKey("global")).toBe(
      "kody-sessions-v3:test-owner/test-repo",
    );
  });

  it("scopes non-global buckets with a -<scope> suffix on the base", async () => {
    installStorage(AUTH);
    const { getStorageKey } = await loadModule();
    expect(getStorageKey("vibe-default")).toBe(
      "kody-sessions-v3-vibe-default:test-owner/test-repo",
    );
  });

  it("falls back to the unscoped legacy key when no repo was ever seen", async () => {
    installStorage(); // no kody_auth
    const { getStorageKey } = await loadModule();
    expect(getStorageKey("global")).toBe("kody-sessions-v3");
  });

  it("keeps the last resolved repo key across a transient kody_auth removal", async () => {
    const store = installStorage(AUTH);
    const { getStorageKey } = await loadModule();
    expect(getStorageKey("global")).toBe(SCOPED_KEY);
    store.removeItem("kody_auth"); // token-refresh blip
    expect(getStorageKey("global")).toBe(SCOPED_KEY);
  });

  it("defaultChatEntryStorageKey is exactly kody-default-chat-entry:test-owner/test-repo", () => {
    installStorage(AUTH);
    expect(defaultChatEntryStorageKey()).toBe(
      "kody-default-chat-entry:test-owner/test-repo",
    );
  });

  it("the sessions-panel pin key in KodyChat.tsx is exactly kody-chat:sessions-panel-pinned", () => {
    // The key is inline in the component (no builder to import without
    // pulling the React tree into a node-env test) — pin the literal at the
    // source level so a rename breaks this test.
    const src = readFileSync(
      resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
      "utf8",
    );
    expect(src).toContain('"kody-chat:sessions-panel-pinned"');
  });

  it("live-session persistence writes under kody-live-sessions:test-owner/test-repo", () => {
    const store = installStorage(AUTH);
    const rec: PersistedLiveSession = {
      sessionId: "live-1",
      state: "ready",
      startedAt: Date.now(),
    };
    saveLiveSession("global", rec);
    expect(store.m.has("kody-live-sessions:test-owner/test-repo")).toBe(true);
    expect(
      JSON.parse(
        store.getItem("kody-live-sessions:test-owner/test-repo") as string,
      ),
    ).toEqual({ global: rec });
  });
});

// ─── v2 → v3 migration ───────────────────────────────────────────────────────

describe("migrateFromV2", () => {
  it("migrates the golden v2 fixture: drops agentId, keeps order, picks non-empty active", async () => {
    installStorage(AUTH);
    const { migrateFromV2 } = await loadModule();
    expect(migrateFromV2(V2_FIXTURE)).toEqual(V2_MIGRATED);
  });

  it("returns an empty v3 store for null input", async () => {
    installStorage(AUTH);
    const { migrateFromV2 } = await loadModule();
    expect(migrateFromV2(null)).toEqual(EMPTY_STORE);
  });

  it("leaves activeSessionId empty when no active session has messages", async () => {
    installStorage(AUTH);
    const { migrateFromV2 } = await loadModule();
    const onlyEmptyActive = {
      ...V2_FIXTURE,
      messages: {},
      activeSessionId: { brain: "s-brain-1" },
    } as unknown as GlobalChatStore;
    expect(migrateFromV2(onlyEmptyActive).activeSessionId).toBe("");
  });
});

// ─── loadStore: parse + migration order ──────────────────────────────────────

describe("loadStore", () => {
  it("parses a current v3 payload under the scoped key", async () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, JSON.stringify(V3_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V3_FIXTURE);
  });

  it("migration order: scoped v3 wins — legacy unscoped data is NOT adopted or deleted", async () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, JSON.stringify(V3_FIXTURE));
    const legacyBlob = JSON.stringify({
      ...EMPTY_STORE,
      activeSessionId: "legacy-only",
    });
    store.setItem(LEGACY_KEY, legacyBlob);
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V3_FIXTURE);
    expect(store.getItem(LEGACY_KEY)).toBe(legacyBlob); // untouched
  });

  it("migrates a v2 payload found under the scoped key and writes it back", async () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, JSON.stringify(V2_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V2_MIGRATED);
    // Migration is persisted in place, same key.
    expect(JSON.parse(store.getItem(SCOPED_KEY) as string)).toEqual(
      V2_MIGRATED,
    );
  });

  it("adopts a legacy unscoped v3 payload under the scoped key and deletes the legacy entry", async () => {
    const store = installStorage(AUTH);
    store.setItem(LEGACY_KEY, JSON.stringify(V3_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V3_FIXTURE);
    expect(JSON.parse(store.getItem(SCOPED_KEY) as string)).toEqual(V3_FIXTURE);
    expect(store.getItem(LEGACY_KEY)).toBeNull(); // one-time move
  });

  it("adopts a legacy unscoped v2 payload by migrating it first", async () => {
    const store = installStorage(AUTH);
    store.setItem(LEGACY_KEY, JSON.stringify(V2_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V2_MIGRATED);
    expect(JSON.parse(store.getItem(SCOPED_KEY) as string)).toEqual(
      V2_MIGRATED,
    );
    expect(store.getItem(LEGACY_KEY)).toBeNull();
  });

  it("never adopts legacy data into non-global scopes (vibe-default starts empty)", async () => {
    const store = installStorage(AUTH);
    store.setItem(LEGACY_KEY, JSON.stringify(V3_FIXTURE));
    const { loadStore } = await loadModule();
    const vibeKey = "kody-sessions-v3-vibe-default:test-owner/test-repo";
    expect(loadStore(vibeKey, "vibe-default")).toEqual(EMPTY_STORE);
    expect(store.getItem(LEGACY_KEY)).not.toBeNull(); // left for global to adopt
  });

  it("reading the unscoped key itself does not self-adopt or delete anything", async () => {
    const store = installStorage(); // no repo connected
    store.setItem(LEGACY_KEY, JSON.stringify(V3_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(LEGACY_KEY, "global")).toEqual(V3_FIXTURE);
    expect(store.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("corrupt/truncated JSON under the scoped key falls back to an empty store without throwing", async () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, CORRUPT_JSON);
    const { loadStore } = await loadModule();
    expect(() => loadStore(SCOPED_KEY, "global")).not.toThrow();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(EMPTY_STORE);
  });

  it("corrupt legacy JSON during adoption also falls back safely (no throw, no deletion)", async () => {
    const store = installStorage(AUTH);
    store.setItem(LEGACY_KEY, CORRUPT_JSON);
    const { loadStore } = await loadModule();
    expect(() => loadStore(SCOPED_KEY, "global")).not.toThrow();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(EMPTY_STORE);
    expect(store.getItem(LEGACY_KEY)).toBe(CORRUPT_JSON); // catch path skips removal
  });

  it("an unknown version number is ignored and legacy adoption still runs", async () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, JSON.stringify({ ...V3_FIXTURE, version: 99 }));
    store.setItem(LEGACY_KEY, JSON.stringify(V3_FIXTURE));
    const { loadStore } = await loadModule();
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V3_FIXTURE);
  });

  it("returns an empty store with no window (SSR safety)", async () => {
    const { loadStore } = await loadModule(); // no installStorage — node globals only
    expect(loadStore(SCOPED_KEY, "global")).toEqual(EMPTY_STORE);
  });
});

// ─── serialize → parse round-trip (schema snapshot) ──────────────────────────

describe("v3 schema round-trip", () => {
  it("saveStore + flushSave serializes the exact v3 schema and loadStore round-trips it", async () => {
    const store = installStorage(AUTH);
    const { saveStore, flushSave, loadStore } = await loadModule();

    saveStore(V3_FIXTURE, SCOPED_KEY);
    // Saves are debounced 1s — flushSave commits synchronously.
    flushSave(SCOPED_KEY);

    const raw = store.getItem(SCOPED_KEY);
    expect(raw).not.toBeNull();

    // Snapshot-style: the serialized payload must parse to EXACTLY this
    // shape. Any field rename, dropped field, or version bump fails here.
    expect(JSON.parse(raw as string)).toEqual({
      version: 3,
      sessions: [
        {
          id: "1700000000000-aaaaaaa",
          title: "Fix the login bug",
          preview: "the login page 500s when…",
          createdAt: "2026-01-01T10:00:00.000Z",
          updatedAt: "2026-01-01T10:05:00.000Z",
          messageCount: 2,
          pinned: true,
          agentKey: "kody-live",
        },
        {
          id: "1700000001000-bbbbbbb",
          title: "New conversation",
          createdAt: "2026-01-02T09:00:00.000Z",
          updatedAt: "2026-01-02T09:00:00.000Z",
          messageCount: 0,
          pinned: false,
        },
      ],
      messages: {
        "1700000000000-aaaaaaa": [
          {
            role: "user",
            text: "the login page 500s when I submit",
            timestamp: "2026-01-01T10:00:00.000Z",
          },
          {
            role: "assistant",
            text: "Looking into it.",
            timestamp: "2026-01-01T10:05:00.000Z",
            model: "claude",
            toolCalls: [
              {
                name: "read_file",
                arguments: { path: "app/login.tsx" },
                status: "success",
              },
            ],
          },
        ],
        "1700000001000-bbbbbbb": [],
      },
      activeSessionId: "1700000000000-aaaaaaa",
    });

    // Full round-trip: what was saved loads back deep-equal.
    expect(loadStore(SCOPED_KEY, "global")).toEqual(V3_FIXTURE);
  });

  it("flushSave commits a pending debounced write for its own key only", async () => {
    const store = installStorage(AUTH);
    const { saveStore, flushSave } = await loadModule();
    const otherKey = "kody-sessions-v3-vibe-default:test-owner/test-repo";

    saveStore(V3_FIXTURE, SCOPED_KEY);
    saveStore(EMPTY_STORE, otherKey);
    flushSave(SCOPED_KEY);

    expect(store.getItem(SCOPED_KEY)).not.toBeNull();
    expect(store.getItem(otherKey)).toBeNull(); // still debounced
    flushSave(otherKey); // clean up the pending timer for test isolation
  });
});
