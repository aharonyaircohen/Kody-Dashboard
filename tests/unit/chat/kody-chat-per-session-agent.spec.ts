/**
 * Source-level + type-level test for the per-session agent pick
 * (`SessionMeta.agentKey`). Each chat session now remembers its own
 * chosen assistant — switching conversations restores the agent that
 * was active for that thread instead of a single global default.
 *
 * Three pieces are pinned here so a future refactor can't silently
 * regress the per-session memory:
 *   1. The `SessionMeta` shape carries the optional `agentKey` field.
 *   2. `useChatSessions` exposes `setSessionAgent` and accepts
 *      `{ agentKey }` in `createSession` so callers can seed + mutate
 *      the per-session pick.
 *   3. `KodyChat` writes the active session on every user-visible agent
 *      change path — picker click, model-emitted switch directive,
 *      and live-session rehydrate — so the pick is never lost.
 *
 * Behavioral coverage (full React render) is intentionally not attempted
 * here: the test environment is "node" and the codebase has no
 * @testing-library/react setup, so source-level assertions match the
 * established pattern in chat-header-icon-only.spec.ts and
 * voice-wake-lock.spec.ts.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { SessionMeta } from "@dashboard/lib/chat-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_TYPES_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/chat-types.ts",
);
const HOOK_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/hooks/useChatSessions.ts",
);
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/KodyChat.tsx",
);

const CHAT_TYPES_SOURCE = readFileSync(CHAT_TYPES_PATH, "utf8");
const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf8");
const KODY_CHAT_SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");

describe("SessionMeta.agentKey — per-session agent memory", () => {
  it("declares agentKey as an optional field on SessionMeta", () => {
    // The field is the per-session pick. Optional so legacy sessions
    // created before the field existed round-trip cleanly.
    expect(CHAT_TYPES_SOURCE).toMatch(
      /interface\s+SessionMeta\s*\{[\s\S]*?\bagentKey\?:\s*string\b/,
    );
  });

  it("round-trips a per-session pick through the type without losing the key", () => {
    const session: SessionMeta = {
      id: "sess-1",
      title: "Test",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
      messageCount: 0,
      pinned: false,
      agentKey: "kody:claude-sonnet",
    };
    expect(session.agentKey).toBe("kody:claude-sonnet");
  });

  it("allows a session to omit agentKey (legacy shape)", () => {
    // Compile-time check: the field is optional, so a session without
    // it is still a valid SessionMeta. The runtime check below makes
    // the structural intent explicit.
    const legacy: SessionMeta = {
      id: "sess-2",
      title: "Legacy",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
      messageCount: 0,
      pinned: false,
    };
    expect(legacy.agentKey).toBeUndefined();
  });
});

describe("useChatSessions — per-session agent API surface", () => {
  it("exposes setSessionAgent on the hook's return type", () => {
    // The signature accepts a session id + entry key and is documented
    // as no-op when the session no longer exists.
    expect(HOOK_SOURCE).toMatch(
      /setSessionAgent:\s*\(\s*sessionId:\s*string,\s*agentKey:\s*string\s*\)\s*=>\s*void/,
    );
  });

  it("implements setSessionAgent with a per-session guard (no write on unknown session)", () => {
    // Pull the function body and confirm the unknown-session early return.
    const setSessionAgentBody = extractCallbackBody(
      HOOK_SOURCE,
      "setSessionAgent",
    );
    expect(
      setSessionAgentBody,
      "setSessionAgent body should be defined",
    ).toBeTruthy();
    expect(setSessionAgentBody).toContain("!prev.sessions.some");
    // Persists via the debounced save path so the pick survives reloads.
    expect(setSessionAgentBody).toMatch(/saveStore\(newStore,\s*storageKey\)/);
  });

  it("accepts an optional agentKey when creating a session", () => {
    // createSession now optionally seeds the per-session pick so a
    // "New conversation" button can inherit the current agent.
    expect(HOOK_SOURCE).toMatch(
      /createSession:\s*\(\s*opts\?:\s*\{\s*agentKey\?:\s*string\s*\}\s*\)\s*=>\s*string/,
    );
  });

  it("seeds the new session's agentKey when createSession is called with one", () => {
    // The seed is spread conditionally so legacy callers passing no
    // opts (or `undefined`) don't accidentally persist `agentKey: undefined`.
    const createSessionBody = extractCallbackBody(HOOK_SOURCE, "createSession");
    expect(
      createSessionBody,
      "createSession body should be defined",
    ).toBeTruthy();
    expect(createSessionBody).toMatch(/opts\?\.agentKey\s*\?\s*\{\s*agentKey:/);
  });
});

describe("KodyChat — writes per-session agent on every change path", () => {
  it("picker click writes the chosen entry to the active session (not the global default)", () => {
    // The picker onClick must call setSessionAgent on the active
    // session id, and must NOT call writeDefaultChatEntry (per the
    // explicit user preference that Settings → "Default chat" is the
    // sole owner of the global default).
    expect(KODY_CHAT_SOURCE).toMatch(
      /sessionHook\.setSessionAgent\(\s*activeId,\s*a\.key\s*\)/,
    );
    expect(KODY_CHAT_SOURCE).not.toMatch(
      /onClick=\{\(\) => \{[\s\S]*?writeDefaultChatEntry\(a\.key\)/,
    );
  });

  it("'New conversation' button seeds the new session with the current effective agent", () => {
    // createSession() now takes an agentKey seeded from the active
    // dropdown row so a fresh thread inherits the agent the user is
    // on — without this, a new chat would reset to the global default.
    // Match across prettier's multi-line wrap: the trailing `)` may
    // land on its own line with a trailing comma in between.
    expect(KODY_CHAT_SOURCE).toMatch(
      /createSession\(\s*seed\s*\?\s*\{\s*agentKey:\s*seed\s*\}\s*:\s*undefined\s*,?\s*\)/,
    );
  });

  it("model-emitted switch_agent directive mirrors onto the active session", () => {
    // The kody-direct stream handler used to setSelectedAgentId only.
    // The per-session fix also writes the resolved entry key back to
    // the active session so a refresh keeps the new agent.
    const switchBlock = extractRegionAround(
      KODY_CHAT_SOURCE,
      "isSwitchAgentDirective(pendingSwitchAgent)",
    );
    expect(switchBlock).toMatch(
      /sessionHook\.setSessionAgent\(\s*activeId,\s*targetEntry\.key\s*\)/,
    );
  });

  it("rehydrated Kody Live session mirrors onto the active session", () => {
    // After a page refresh, rehydrate restores the runner AND seeds
    // the active session's agentKey so a subsequent session switch
    // doesn't bounce the user off Live. The `type: "REHYDRATE_RESTORED"`
    // dispatch literal is the precise anchor — the same string also
    // appears in a comment further up the file, which is why this
    // test scopes to the action object, not the bare identifier.
    const rehydrateBlock = extractRegionAround(
      KODY_CHAT_SOURCE,
      'type: "REHYDRATE_RESTORED"',
    );
    expect(rehydrateBlock).toMatch(
      /sessionHook\.setSessionAgent\(\s*rehydrateId,\s*rehydrateEntry\.key\s*\)/,
    );
  });

  it("defines a per-session agent sync effect that adopts the active session's agentKey", () => {
    // The effect is the single source of truth for "what agent is
    // visible right now": it adopts the active session's pick (or
    // falls through family-snap → default), and writes the resolved
    // pick back so legacy sessions are captured the first time the
    // user looks at them.
    const syncBlock = extractRegionAround(
      KODY_CHAT_SOURCE,
      "Per-session agent sync",
    );
    expect(syncBlock).toMatch(/session\.agentKey/);
    expect(syncBlock).toMatch(/familySnap/);
    expect(syncBlock).toMatch(/defaultAgentEntry/);
    // Writes back when the session has no pick yet (or the resolved
    // target differs from the stored key).
    expect(syncBlock).toMatch(
      /sessionHook\.setSessionAgent\(\s*session\.id,\s*targetEntry\.key\s*\)/,
    );
  });

  it("does not call writeDefaultChatEntry from the chat picker", () => {
    // Global default owner is Settings → "Default chat" only. The
    // chat picker mutates the active session; it must not silently
    // change the default for new sessions.
    const importMatches = [
      ...KODY_CHAT_SOURCE.matchAll(/writeDefaultChatEntry/g),
    ];
    expect(importMatches.length).toBe(0);
  });
});

/**
 * Extract the body of `const <name> = useCallback((...) => { ... }, [...])`
 * for a given callback name. Returns the body between the opening `{`
 * after the arrow and the matching `}` before the dependency array.
 * Tracks nested braces so an inner `{}` doesn't terminate the match early.
 */
function extractCallbackBody(source: string, name: string): string | null {
  const signature = `const ${name} = useCallback(`;
  const start = source.indexOf(signature);
  if (start === -1) return null;
  // Find the first `{` after the arrow `=>` — that's the body opener.
  const arrowIdx = source.indexOf("=>", start);
  if (arrowIdx === -1) return null;
  const bodyOpen = source.indexOf("{", arrowIdx);
  if (bodyOpen === -1) return null;
  let depth = 0;
  for (let i = bodyOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyOpen + 1, i);
      }
    }
  }
  return null;
}

/**
 * Return a ~3KB slice of source centered on the first occurrence of
 * `marker`. Used to bound assertions to a specific code region without
 * having to regex against the full file.
 */
function extractRegionAround(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) return "";
  const half = 3000;
  const start = Math.max(0, idx - half);
  const end = Math.min(source.length, idx + half);
  return source.slice(start, end);
}
