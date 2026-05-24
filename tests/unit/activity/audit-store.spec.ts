/**
 * Unit tests for the durable audit-log store. The GitHub-backed manifest CAS
 * (`createManifestStore`) is mocked so we exercise audit-store's OWN logic in
 * isolation: the newest-first prepend, the MAX_DURABLE cap, detail clamping,
 * and the body parse/serialize/equality the store is configured with.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  config: null as any,
  seeded: [] as any[],
  lastNext: null as any,
  mutateCalls: 0,
}));

vi.mock("@dashboard/lib/manifest-store", () => ({
  createManifestStore: (config: any) => {
    h.config = config;
    return {
      readFresh: async () => ({ number: null, manifest: config.empty() }),
      readCached: async () => ({ version: 1, events: h.seeded }),
      mutate: async (mutator: any) => {
        h.mutateCalls += 1;
        const current = { version: 1, events: h.seeded };
        const out = await mutator(current);
        if ("kind" in out) return { kind: "noop", result: out.result };
        h.lastNext = out.next;
        return { result: out.result, manifest: out.next, issueNumber: 1 };
      },
    };
  },
}));

import {
  appendAuditDurable,
  readAuditDurable,
} from "@dashboard/lib/activity/audit-store";
import type { AuditEvent } from "@dashboard/lib/activity/action-log";

function ev(id: string, detail: string | null = null): AuditEvent {
  return {
    id,
    at: `2026-05-22T00:00:${id.padStart(2, "0")}Z`,
    type: "duty.run",
    target: "changelog-verify",
    actor: "alice",
    repo: "acme/widgets",
    detail,
    duty: "changelog-verify",
    staff: "qa-engineer",
    outcome: "ok",
    source: "dashboard",
  };
}

beforeEach(() => {
  h.seeded = [];
  h.lastNext = null;
  h.mutateCalls = 0;
});

describe("appendAuditDurable", () => {
  it("prepends new events newest-first", async () => {
    h.seeded = [ev("01"), ev("02")];
    await appendAuditDurable([ev("03")]);
    expect(h.lastNext.events.map((e: AuditEvent) => e.id)).toEqual([
      "03",
      "01",
      "02",
    ]);
  });

  it("caps the ring at 150 events", async () => {
    h.seeded = Array.from({ length: 150 }, (_, i) => ev(`s${i}`));
    await appendAuditDurable([ev("n1"), ev("n2"), ev("n3")]);
    expect(h.lastNext.events).toHaveLength(150);
    // The three new entries survive at the front; the three oldest fall off.
    expect(h.lastNext.events.slice(0, 3).map((e: AuditEvent) => e.id)).toEqual([
      "n1",
      "n2",
      "n3",
    ]);
  });

  it("clamps an over-long detail to 160 chars with an ellipsis", async () => {
    await appendAuditDurable([ev("01", "x".repeat(300))]);
    const detail = h.lastNext.events[0].detail as string;
    expect(detail).toHaveLength(160);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("is a no-op (no write) for an empty batch", async () => {
    const ok = await appendAuditDurable([]);
    expect(ok).toBe(true);
    expect(h.mutateCalls).toBe(0);
  });
});

describe("readAuditDurable", () => {
  it("returns the cached ring", async () => {
    h.seeded = [ev("01"), ev("02")];
    await expect(readAuditDurable()).resolves.toEqual(h.seeded);
  });
});

describe("manifest body parse/serialize (the store config)", () => {
  it("round-trips events through serialize → parse", () => {
    const events = [ev("01", "created"), ev("02", null)];
    const body = h.config.serialize({ version: 1, events });
    expect(h.config.parse(body).events).toEqual(events);
  });

  it("returns an empty manifest for missing markers or null body", () => {
    expect(h.config.parse("just some prose, no markers").events).toEqual([]);
    expect(h.config.parse(null).events).toEqual([]);
    expect(h.config.empty()).toEqual({ version: 1, events: [] });
  });

  it("equality is id-and-order sensitive (drives CAS verify)", () => {
    const a = { version: 1 as const, events: [ev("01"), ev("02")] };
    expect(h.config.equals(a, a)).toBe(true);
    expect(h.config.equals(a, { version: 1, events: [ev("01")] })).toBe(false);
    expect(
      h.config.equals(a, { version: 1, events: [ev("02"), ev("01")] }),
    ).toBe(false);
  });
});
