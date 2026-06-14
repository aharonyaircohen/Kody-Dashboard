/**
 * Unit tests for the stateless HMAC session token
 * (src/dashboard/lib/chat-token.ts) that authenticates engine→dashboard
 * chat-event ingest POSTs. A forgery or a constant-time-compare regression
 * here would let an unauthenticated caller inject events into any session,
 * so the verify path is security-load-bearing.
 *
 * Covers: mint determinism, round-trip verify, rejection of forged/wrong
 * tokens, per-session uniqueness, master-key separation (rotation
 * invalidates tokens), and the missing-key error path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mintSessionToken,
  verifySessionToken,
} from "@dashboard/lib/chat-token";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = "test-master-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = savedKey;
});

describe("chat session token", () => {
  it("mints a deterministic 32-hex-char token", () => {
    const t = mintSessionToken("session-1");
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(mintSessionToken("session-1")).toBe(t);
  });

  it("verifies a freshly minted token", () => {
    expect(verifySessionToken("session-1", mintSessionToken("session-1"))).toBe(
      true,
    );
  });

  it("rejects a token minted for a different session", () => {
    const other = mintSessionToken("session-2");
    expect(verifySessionToken("session-1", other)).toBe(false);
  });

  it("rejects a forged / garbage token", () => {
    expect(
      verifySessionToken("session-1", "deadbeefdeadbeefdeadbeefdeadbeef"),
    ).toBe(false);
    expect(verifySessionToken("session-1", "not-hex")).toBe(false);
    expect(verifySessionToken("session-1", "")).toBe(false);
  });

  it("rejects a token of the wrong length without throwing", () => {
    // Length mismatch must short-circuit before timingSafeEqual (which throws
    // on unequal buffer lengths).
    expect(verifySessionToken("session-1", "abcd")).toBe(false);
  });

  it("produces distinct tokens per session id", () => {
    expect(mintSessionToken("a")).not.toBe(mintSessionToken("b"));
  });

  it("invalidates tokens when the master key rotates", () => {
    const before = mintSessionToken("session-1");
    process.env.KODY_MASTER_KEY = "rotated-master-key-bbbbbbbbbbbbbbbbbbbb";
    expect(mintSessionToken("session-1")).not.toBe(before);
    expect(verifySessionToken("session-1", before)).toBe(false);
  });

  it("throws when the master key is missing", () => {
    delete process.env.KODY_MASTER_KEY;
    expect(() => mintSessionToken("session-1")).toThrow(
      /KODY_MASTER_KEY not configured/,
    );
  });
});
