/**
 * Source-level structural tests for org-scoped Kody Chat.
 *
 * Org chat is owned by the persistent rail, so these assertions pin the
 * load-bearing pieces without a browser renderer: the org payload is sent
 * to the direct chat route, while the org page title/dropdown remains the
 * visible organization indicator.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Phase 1.6b moved the send pipeline (org forwarding lives in the
// kody-direct request body) to kody-chat-send.ts; the mode flags stay
// in KodyChat.tsx. The assertions are unchanged and run against the
// concatenation of both files.
const KODY_CHAT_SOURCE =
  readFileSync(
    resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
    "utf8",
  ) +
  "\n" +
  readFileSync(
    resolve(__dirname, "../../src/dashboard/lib/components/kody-chat-send.ts"),
    "utf8",
  );
const USE_CHAT_SESSIONS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/core/use-chat-sessions.ts"),
  "utf8",
);
const SYSTEM_PROMPT_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/chat/kody/system-prompt.ts"),
  "utf8",
);

describe("KodyChat org scope", () => {
  it("forwards org scope to the Kody direct route", () => {
    expect(KODY_CHAT_SOURCE).toMatch(/selectedOrg/);
    expect(KODY_CHAT_SOURCE).toMatch(/owner:\s*selectedOrg\.org/);
    expect(KODY_CHAT_SOURCE).toMatch(
      /repositories:\s*selectedOrg\.repositories/,
    );
  });

  it("keeps org context invisible in chat chrome", () => {
    expect(KODY_CHAT_SOURCE).not.toMatch(/Org scope/);
    expect(KODY_CHAT_SOURCE).not.toMatch(/Org chat/);
    expect(KODY_CHAT_SOURCE).not.toMatch(/selectedOrg\.repositories\?\.length/);
  });

  it("does not make org selection a chat session boundary", () => {
    expect(USE_CHAT_SESSIONS_SOURCE).not.toMatch(/`org:${string}`/);
    expect(KODY_CHAT_SOURCE).not.toMatch(/`org:${selectedOrg/);
  });

  it("keeps org pages in global chat UI mode", () => {
    expect(KODY_CHAT_SOURCE).toMatch(
      /const\s+isGlobalMode\s*=\s*!isTaskMode\s*&&\s*!isCapabilityMode\s*&&\s*!isPlannerMode;/,
    );
    expect(KODY_CHAT_SOURCE).not.toMatch(/!selectedOrg && !isTaskMode/);
  });

  it("frames org scope in the system prompt", () => {
    expect(SYSTEM_PROMPT_SOURCE).toMatch(/## Org workspace scope/);
    expect(SYSTEM_PROMPT_SOURCE).toMatch(
      /write action[\s\S]*concrete repository/,
    );
  });
});
