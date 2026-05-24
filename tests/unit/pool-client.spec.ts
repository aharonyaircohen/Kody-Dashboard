/**
 * claimFromPool must NEVER throw — on any failure it returns ok:false so the
 * Vibe execute path falls back to create-fresh. These tests pin that contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimFromPool } from "@dashboard/lib/runners/pool-client";
import { _resetPoolKeyCacheForTests } from "@dashboard/lib/runners/pool-keys";

const JOB = {
  jobId: "vibe-issue-7-1",
  repo: "owner/name",
  issueNumber: 7,
};

const ORIGINAL_KEY = process.env.KODY_MASTER_KEY;

beforeEach(() => {
  _resetPoolKeyCacheForTests();
  process.env.KODY_MASTER_KEY = "a".repeat(64);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = ORIGINAL_KEY;
  _resetPoolKeyCacheForTests();
});

describe("claimFromPool", () => {
  it("returns ok with machineId on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, machineId: "m123" }), {
            status: 200,
          }),
      ),
    );
    const out = await claimFromPool(JOB);
    expect(out).toEqual({ ok: true, machineId: "m123" });
  });

  it("returns ok:false on 503 (empty pool → caller falls back)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, reason: "pool empty" }), {
            status: 503,
          }),
      ),
    );
    const out = await claimFromPool(JOB);
    expect(out.ok).toBe(false);
  });

  it("returns ok:false (never throws) on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const out = await claimFromPool(JOB);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/ECONNREFUSED/);
  });

  it("returns ok:false when KODY_MASTER_KEY is unset (no key to sign with)", async () => {
    delete process.env.KODY_MASTER_KEY;
    _resetPoolKeyCacheForTests();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await claimFromPool(JOB);
    expect(out.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled(); // no key → don't even try
  });

  it("returns ok:false when 200 lacks a machineId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    );
    const out = await claimFromPool(JOB);
    expect(out.ok).toBe(false);
  });
});
