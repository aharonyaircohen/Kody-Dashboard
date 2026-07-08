/**
 * Unit tests for the default-chat-entry localStorage helpers
 * (src/dashboard/lib/chat/default-entry.ts). These persist the per-user pick
 * of which assistant loads on chat open — written from Settings, read by the
 * chat picker on mount.
 *
 * Load-bearing behavior: the storage key is repo-scoped (lowercased) so a
 * default chosen for repo A can't bleed into repo B, it degrades to a shared
 * base key when no repo is connected, and every accessor is SSR-safe (no
 * `window` → no throw).
 *
 * The vitest environment is "node", so there's no real `window`. Each test
 * installs a Map-backed fake on `globalThis.window`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  defaultChatEntryStorageKey,
  readDefaultChatEntry,
  writeDefaultChatEntry,
  clearDefaultChatEntry,
} from "@dashboard/lib/chat/platform/default-entry";

class MemStorage {
  private m = new Map<string, string>();
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

function installWindow(authJson?: object): MemStorage {
  const store = new MemStorage();
  if (authJson) store.setItem("kody_auth", JSON.stringify(authJson));
  (globalThis as { window?: unknown }).window = { localStorage: store };
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const BASE = "kody-default-chat-entry";

describe("defaultChatEntryStorageKey", () => {
  it("scopes the key to the connected repo, lowercased", () => {
    installWindow({ owner: "AcmeOrg", repo: "Kody-Dashboard" });
    expect(defaultChatEntryStorageKey()).toBe(`${BASE}:acmeorg/kody-dashboard`);
  });

  it("falls back to the base key when no repo is connected", () => {
    installWindow();
    expect(defaultChatEntryStorageKey()).toBe(BASE);
  });

  it("falls back to the base key when owner/repo are missing", () => {
    installWindow({ owner: "acme" }); // no repo
    expect(defaultChatEntryStorageKey()).toBe(BASE);
  });

  it("returns the base key under SSR (no window)", () => {
    expect(defaultChatEntryStorageKey()).toBe(BASE);
  });
});

describe("read / write / clear", () => {
  let store: MemStorage;
  /** Repaint the connected repo on the *same* store (simulates repo switch). */
  const connect = (owner: string, repo: string) =>
    store.setItem("kody_auth", JSON.stringify({ owner, repo }));

  beforeEach(() => {
    store = installWindow({ owner: "acme", repo: "repo1" });
  });

  it("round-trips a value under the repo-scoped key", () => {
    expect(readDefaultChatEntry()).toBeNull();
    writeDefaultChatEntry("kody:gpt-x");
    expect(readDefaultChatEntry()).toBe("kody:gpt-x");
    // Stored under the scoped key, not the bare base key.
    expect(store.getItem(`${BASE}:acme/repo1`)).toBe("kody:gpt-x");
    expect(store.getItem(BASE)).toBeNull();
  });

  it("clear removes the saved pick (back to automatic)", () => {
    writeDefaultChatEntry("brain");
    expect(readDefaultChatEntry()).toBe("brain");
    clearDefaultChatEntry();
    expect(readDefaultChatEntry()).toBeNull();
  });

  it("isolates defaults across repos on one store", () => {
    writeDefaultChatEntry("brain"); // repo1
    connect("acme", "repo2");
    expect(readDefaultChatEntry()).toBeNull(); // repo2 has its own key
    writeDefaultChatEntry("kody:claude-y"); // repo2
    connect("acme", "repo1");
    expect(readDefaultChatEntry()).toBe("brain"); // repo1 untouched
  });
});

describe("SSR safety (no window)", () => {
  it("read returns null and write/clear are no-ops", () => {
    expect(readDefaultChatEntry()).toBeNull();
    expect(() => writeDefaultChatEntry("brain")).not.toThrow();
    expect(() => clearDefaultChatEntry()).not.toThrow();
  });
});
