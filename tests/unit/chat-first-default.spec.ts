/**
 * @fileoverview Pins the chat-first default-flip contract (phase 2 step 5):
 * with NO stored key, readChatFirstLayout follows CHAT_FIRST_DEFAULT — the
 * one-line flip later is changing that constant, nothing else. Explicit
 * stored values ("1"/"0") always win over the default, and unavailable
 * storage also reads as the default.
 *
 * @testFramework vitest
 * @domain layout
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_FIRST_DEFAULT,
  CHAT_FIRST_LAYOUT_KEY,
  readChatFirstLayout,
} from "@dashboard/lib/hooks/use-chat-first-layout";

function stubStorage(entries: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in entries ? entries[key] : null),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat-first layout default flip (step 5 preparation)", () => {
  it("the prepared default is still OFF (flip is a later product decision)", () => {
    expect(CHAT_FIRST_DEFAULT).toBe(false);
  });

  it("absent key follows CHAT_FIRST_DEFAULT", () => {
    stubStorage({});
    expect(readChatFirstLayout()).toBe(CHAT_FIRST_DEFAULT);
  });

  it("unavailable storage follows CHAT_FIRST_DEFAULT", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(readChatFirstLayout()).toBe(CHAT_FIRST_DEFAULT);
  });

  it("an explicit stored value wins over the default in both directions", () => {
    stubStorage({ [CHAT_FIRST_LAYOUT_KEY]: "1" });
    expect(readChatFirstLayout()).toBe(true);
    stubStorage({ [CHAT_FIRST_LAYOUT_KEY]: "0" });
    expect(readChatFirstLayout()).toBe(false);
  });
});
