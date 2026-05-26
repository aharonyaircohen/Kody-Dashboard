/**
 * Unit tests for the shared Web Push primitive
 * (src/dashboard/lib/notifications/channels/push-core.ts). Both the rules
 * broadcast and the per-recipient mention fan-out delegate to deliverPush, so
 * its send-count accounting and 404/410 pruning must be exact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    WebPushError,
    sendNotification: vi.fn(),
    setVapidDetails: vi.fn(),
    mutatePushManifest: vi.fn().mockResolvedValue(1),
    setGitHubContext: vi.fn(),
    clearGitHubContext: vi.fn(),
    deriveVapidKeys: vi.fn(() => ({ publicKey: "pub", privateKey: "priv" })),
  };
});

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: h.setVapidDetails,
    sendNotification: h.sendNotification,
  },
  WebPushError: h.WebPushError,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));
vi.mock("@dashboard/lib/push-server", () => ({
  mutatePushManifest: h.mutatePushManifest,
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/push/vapid-keys", () => ({
  deriveVapidKeys: h.deriveVapidKeys,
}));

import {
  deliverPush,
  ensureVapid,
} from "@dashboard/lib/notifications/channels/push-core";

function sub(login: string) {
  return {
    endpoint: `https://push/${login}`,
    keys: { p256dh: "p", auth: "a" },
    userLogin: login,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const gh = { owner: "acme", repo: "widgets", token: "t" };

beforeEach(() => {
  vi.clearAllMocks();
  h.sendNotification.mockResolvedValue(undefined);
  h.deriveVapidKeys.mockReturnValue({ publicKey: "pub", privateKey: "priv" });
});

describe("ensureVapid", () => {
  it("returns true when keys derive, false when derivation throws", () => {
    expect(ensureVapid()).toBe(true);
    h.deriveVapidKeys.mockImplementationOnce(() => {
      throw new Error("no master key");
    });
    expect(ensureVapid()).toBe(false);
  });
});

describe("deliverPush", () => {
  it("sends to every subscription and counts successes", async () => {
    const r = await deliverPush({
      subscriptions: [sub("a"), sub("b")],
      payload: () => "{}",
      github: gh,
      logLabel: "test",
    });
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ sent: 2, failed: 0, pruned: 0 });
    expect(h.mutatePushManifest).not.toHaveBeenCalled();
  });

  it("prunes a subscription that returns 410 and counts it failed", async () => {
    h.sendNotification
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new h.WebPushError("gone", 410));
    const r = await deliverPush({
      subscriptions: [sub("a"), sub("b")],
      payload: () => "{}",
      github: gh,
      logLabel: "test",
    });
    expect(r).toEqual({ sent: 1, failed: 1, pruned: 1 });
    expect(h.mutatePushManifest).toHaveBeenCalledTimes(1);
  });

  it("does not prune on a non-expiry failure", async () => {
    h.sendNotification.mockRejectedValueOnce(new Error("timeout"));
    const r = await deliverPush({
      subscriptions: [sub("a")],
      payload: () => "{}",
      github: gh,
      logLabel: "test",
    });
    expect(r).toEqual({ sent: 0, failed: 1, pruned: 0 });
    expect(h.mutatePushManifest).not.toHaveBeenCalled();
  });

  it("uses the per-subscription payload builder", async () => {
    await deliverPush({
      subscriptions: [sub("a"), sub("b")],
      payload: (s) => JSON.stringify({ to: s.userLogin }),
      github: gh,
      logLabel: "test",
    });
    const bodies = h.sendNotification.mock.calls.map((c) => c[1]);
    expect(bodies).toContain('{"to":"a"}');
    expect(bodies).toContain('{"to":"b"}');
  });
});
