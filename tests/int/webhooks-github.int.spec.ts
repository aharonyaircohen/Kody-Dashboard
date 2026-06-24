/**
 * Integration tests for the GitHub webhook receiver
 * (app/api/webhooks/github/route.ts). This route is the backbone of the
 * push-based cache-invalidation architecture that replaced polling — if it
 * stops invalidating, the dashboard silently serves stale data until TTL,
 * and if it stops rejecting non-GitHub IPs it accepts spoofed events. It
 * had no test.
 *
 * The route calls invalidate* + dispatch helpers directly (not HTTP), so we
 * mock those seams and the IP verifier, then drive the handler with real
 * NextRequests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const gh = vi.hoisted(() => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
  invalidateBranchCache: vi.fn(),
  invalidateWorkflowCache: vi.fn(),
  invalidatePRBehindCache: vi.fn(),
  invalidateDiscussionCache: vi.fn(),
}));
const ipv = vi.hoisted(() => ({
  getClientIp: vi.fn(() => "140.82.115.42"),
  isFromGitHub: vi.fn(async () => true),
}));
const side = vi.hoisted(() => ({
  dispatchNotifications: vi.fn(async () => {}),
  dispatchMentionPushes: vi.fn(async () => {}),
  dispatchAgentMentions: vi.fn(async () => {}),
  applyVerdictFromComment: vi.fn(async () => {}),
  handlePrMerged: vi.fn(async () => {}),
  handleReleasePublished: vi.fn(async () => {}),
}));

vi.mock("@dashboard/lib/github-client", () => gh);
vi.mock("@dashboard/lib/webhooks/github-ip", () => ipv);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/notifications-dispatch", () => ({
  dispatchNotifications: side.dispatchNotifications,
}));
vi.mock("@dashboard/lib/push/mention-dispatch", () => ({
  dispatchMentionPushes: side.dispatchMentionPushes,
}));
vi.mock("@dashboard/lib/push/agent-mention-dispatch", () => ({
  dispatchAgentMentions: side.dispatchAgentMentions,
}));
vi.mock("@dashboard/lib/ui-verify/apply-label", () => ({
  applyVerdictFromComment: side.applyVerdictFromComment,
}));
vi.mock("@dashboard/lib/changelog/handlers", () => ({
  handlePrMerged: side.handlePrMerged,
  handleReleasePublished: side.handleReleasePublished,
}));

import { POST } from "../../app/api/webhooks/github/route";

let deliveryCounter = 0;
function makeReq(
  event: string,
  payload: unknown,
  opts: { delivery?: string; rawBody?: string; signature?: string } = {},
) {
  const delivery = opts.delivery ?? `delivery-${++deliveryCounter}`;
  const rawBody = opts.rawBody ?? JSON.stringify(payload);
  return new NextRequest("https://dash.test/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": delivery,
      ...(opts.signature ? { "x-hub-signature-256": opts.signature } : {}),
    },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  ipv.getClientIp.mockReturnValue("140.82.115.42");
  ipv.isFromGitHub.mockResolvedValue(true);
});

function signatureFor(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

describe("POST /api/webhooks/github — auth", () => {
  it("rejects with 403 when the source IP is not GitHub's", async () => {
    ipv.isFromGitHub.mockResolvedValue(false);
    const res = await POST(makeReq("issues", { issue: { number: 1 } }));
    expect(res.status).toBe(403);
    expect(gh.invalidateIssueCache).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    const res = await POST(makeReq("issues", null, { rawBody: "{ not json" }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid HMAC signature when a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "hook-secret");
    const rawBody = JSON.stringify({ issue: { number: 1 } });

    const res = await POST(
      makeReq("issues", null, {
        rawBody,
        signature: signatureFor(rawBody, "hook-secret"),
      }),
    );

    expect(res.status).toBe(200);
    expect(ipv.isFromGitHub).not.toHaveBeenCalled();
    expect(gh.invalidateIssueCache).toHaveBeenCalledWith(1);
  });

  it("rejects missing or invalid HMAC signatures when a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "hook-secret");

    const missing = await POST(makeReq("issues", { issue: { number: 1 } }));
    expect(missing.status).toBe(403);

    const bad = await POST(
      makeReq("issues", { issue: { number: 1 } }, { signature: "sha256=00" }),
    );
    expect(bad.status).toBe(403);
    expect(gh.invalidateIssueCache).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/github — invalidation routing", () => {
  it("issues → invalidates that issue's cache", async () => {
    const res = await POST(makeReq("issues", { issue: { number: 123 } }));
    expect(res.status).toBe(200);
    expect(gh.invalidateIssueCache).toHaveBeenCalledWith(123);
  });

  it("push → invalidates branch + PR-behind caches", async () => {
    await POST(makeReq("push", { ref: "refs/heads/main" }));
    expect(gh.invalidateBranchCache).toHaveBeenCalledTimes(1);
    expect(gh.invalidatePRBehindCache).toHaveBeenCalledTimes(1);
  });

  it("workflow_run → invalidates the workflow cache", async () => {
    await POST(makeReq("workflow_run", { action: "completed" }));
    expect(gh.invalidateWorkflowCache).toHaveBeenCalledTimes(1);
  });

  it("unknown event → 200 but handled:false", async () => {
    const res = await POST(makeReq("membership", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handled: false });
  });
});

describe("POST /api/webhooks/github — side effects", () => {
  it("appends a changelog entry when a PR is merged", async () => {
    await POST(
      makeReq("pull_request", {
        action: "closed",
        pull_request: { number: 7, merged: true },
      }),
    );
    expect(gh.invalidatePRCache).toHaveBeenCalled();
    expect(side.handlePrMerged).toHaveBeenCalledTimes(1);
  });

  it("does NOT append a changelog entry when a PR is closed unmerged", async () => {
    await POST(
      makeReq("pull_request", {
        action: "closed",
        pull_request: { number: 8, merged: false },
      }),
    );
    expect(side.handlePrMerged).not.toHaveBeenCalled();
  });

  it("applies a verdict label on a new PR comment carrying a Verdict marker", async () => {
    await POST(
      makeReq("issue_comment", {
        action: "created",
        issue: { number: 9, pull_request: {} },
        comment: { body: "Verdict: approve", user: { login: "alice" } },
      }),
    );
    expect(side.applyVerdictFromComment).toHaveBeenCalledWith(
      9,
      expect.stringContaining("Verdict"),
    );
  });

  it("fans the payload out to notifications + mention + agent dispatch", async () => {
    await POST(makeReq("issues", { issue: { number: 5 } }));
    expect(side.dispatchNotifications).toHaveBeenCalledTimes(1);
    expect(side.dispatchMentionPushes).toHaveBeenCalledTimes(1);
    expect(side.dispatchAgentMentions).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/webhooks/github — delivery dedup", () => {
  it("processes a delivery once and short-circuits the redelivery", async () => {
    const first = await POST(
      makeReq("issues", { issue: { number: 42 } }, { delivery: "dup-1" }),
    );
    expect(first.status).toBe(200);
    expect(gh.invalidateIssueCache).toHaveBeenCalledTimes(1);

    const second = await POST(
      makeReq("issues", { issue: { number: 42 } }, { delivery: "dup-1" }),
    );
    expect(await second.json()).toMatchObject({ ok: true, dedup: true });
    // The redelivery must NOT trigger a second invalidation.
    expect(gh.invalidateIssueCache).toHaveBeenCalledTimes(1);
  });
});
