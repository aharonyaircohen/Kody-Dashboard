/**
 * Unit tests for the audit recorder. `next/server`'s `after()` is mocked so
 * the deferred work can be run and awaited deterministically; auth, the
 * GitHub context, and the durable store are stubbed so we assert only
 * recordAudit's own behaviour: a verified actor, the correct AuditEvent
 * shape, and writes to BOTH the in-memory ring and the durable store.
 *
 * The in-memory ring (action-log) is the REAL module — so these tests also
 * cover recordAction's field mapping and the ring's newest-first / cap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  afterFns: [] as Array<() => unknown>,
  appendDurable: vi.fn<
    (events: unknown[], octokit?: unknown) => Promise<boolean>
  >(async () => true),
  getRequestAuth: vi.fn(),
  resolveActor: vi.fn(),
  setGitHubContext: vi.fn(),
  createUserOctokit: vi.fn(() => ({})),
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    h.afterFns.push(fn);
  },
}));
vi.mock("@dashboard/lib/auth", () => ({
  getRequestAuth: h.getRequestAuth,
  resolveActorFromToken: h.resolveActor,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  createUserOctokit: h.createUserOctokit,
}));
vi.mock("@dashboard/lib/activity/audit-store", () => ({
  appendAuditDurable: h.appendDurable,
}));

import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  getActionLog,
  recordAction,
  pushAuditEntry,
} from "@dashboard/lib/activity/action-log";

/** Run every queued after() callback and await it (recordAudit queues one). */
async function flushAfter() {
  const fns = [...h.afterFns];
  h.afterFns.length = 0;
  for (const fn of fns) await fn();
}

beforeEach(() => {
  h.afterFns.length = 0;
  h.appendDurable.mockClear();
  h.getRequestAuth.mockReset();
  h.resolveActor.mockReset();
  h.setGitHubContext.mockClear();
});

describe("recordAudit", () => {
  it("records to both tiers with the VERIFIED actor + full spec mapping", async () => {
    h.getRequestAuth.mockReturnValue({
      owner: "acme",
      repo: "widgets",
      token: "tkn",
    });
    h.resolveActor.mockResolvedValue({
      login: "alice",
      githubId: 1,
      avatarUrl: "",
    });

    recordAudit({} as never, {
      action: "duty.run",
      resource: "changelog-verify",
      duty: "changelog-verify",
      staff: "qa-engineer",
      detail: "manual run",
    });

    // Nothing happens until the after() hook runs.
    expect(h.afterFns).toHaveLength(1);
    await flushAfter();

    const top = getActionLog()[0];
    expect(top).toMatchObject({
      type: "duty.run",
      target: "changelog-verify",
      actor: "alice",
      repo: "acme/widgets",
      duty: "changelog-verify",
      staff: "qa-engineer",
      outcome: "ok",
      source: "dashboard",
    });

    expect(h.appendDurable).toHaveBeenCalledTimes(1);
    const firstBatch = h.appendDurable.mock.calls[0]?.[0] as
      | Array<Record<string, unknown>>
      | undefined;
    expect(firstBatch?.[0]).toMatchObject({ type: "duty.run", actor: "alice" });
  });

  it("falls back to actor 'unknown' and skips the durable write with no auth", async () => {
    h.getRequestAuth.mockReturnValue(null);

    recordAudit({} as never, {
      action: "task.action",
      resource: "#5",
      detail: "approve",
    });
    await flushAfter();

    const top = getActionLog()[0];
    expect(top).toMatchObject({
      type: "task.action",
      target: "#5",
      actor: "unknown",
      repo: null,
    });
    expect(h.appendDurable).not.toHaveBeenCalled();
  });

  it("defaults outcome to ok and never throws", () => {
    h.getRequestAuth.mockReturnValue(null);
    expect(() =>
      recordAudit({} as never, { action: "vault.write", resource: "KEY" }),
    ).not.toThrow();
  });
});

describe("action-log in-memory ring", () => {
  it("recordAction maps fields and getActionLog is newest-first", () => {
    recordAction({ type: "a.first", target: "t1" });
    recordAction({ type: "a.second", target: "t2", actor: "bob" });
    const [first, second] = getActionLog();
    expect(first.type).toBe("a.second");
    expect(first.actor).toBe("bob");
    expect(second.type).toBe("a.first");
    expect(second.actor).toBe("unknown"); // no actor supplied → coarse default
  });

  it("caps the ring at 500 entries", () => {
    for (let i = 0; i < 600; i++) {
      pushAuditEntry({
        id: `cap-${i}`,
        at: new Date().toISOString(),
        type: "noise",
        target: String(i),
        actor: "x",
        repo: null,
        detail: null,
      });
    }
    expect(getActionLog().length).toBe(500);
  });
});
