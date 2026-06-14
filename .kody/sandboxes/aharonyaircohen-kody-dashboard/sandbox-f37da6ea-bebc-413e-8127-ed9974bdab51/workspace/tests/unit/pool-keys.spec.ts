/**
 * Cross-repo parity guard for the warm-pool API key. The dashboard derives the
 * bearer it sends to the pool owner; the engine (kody2 src/pool/keys.ts)
 * derives the value it checks. Both must compute the SAME hex from the SAME
 * master, or every claim 401s. The known-answer below is asserted in BOTH
 * suites — drift in either side's HKDF params breaks one of them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetPoolKeyCacheForTests,
  derivePoolApiKey,
} from "@dashboard/lib/runners/pool-keys";

const ORIGINAL = process.env.KODY_MASTER_KEY;

beforeEach(() => {
  _resetPoolKeyCacheForTests();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = ORIGINAL;
  _resetPoolKeyCacheForTests();
});

describe("derivePoolApiKey", () => {
  it("returns null when KODY_MASTER_KEY is unset (graceful degrade)", () => {
    delete process.env.KODY_MASTER_KEY;
    expect(derivePoolApiKey()).toBeNull();
  });

  it("matches the cross-repo known-answer for master='a'*64", () => {
    process.env.KODY_MASTER_KEY = "a".repeat(64);
    expect(derivePoolApiKey()).toBe(
      "c739037cabcd5935e1e7c4b301e0415855853903d3eae76f81e6d0fcb00a5679",
    );
  });

  it("is a stable 64-char hex string", () => {
    process.env.KODY_MASTER_KEY = "b".repeat(64);
    const k = derivePoolApiKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
