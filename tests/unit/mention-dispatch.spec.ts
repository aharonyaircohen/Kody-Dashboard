/**
 * Unit tests for the webhook→web-push mention fan-out
 * (src/dashboard/lib/push/mention-dispatch.ts). This 700-line module turns
 * a GitHub webhook into targeted device pushes and was at ~0% coverage.
 *
 * Two layers under test:
 *   - `extractMentions`: the @login regex (dedup, case-fold, email/word
 *     boundary handling) — the correctness core.
 *   - `dispatchMentionPushes`: the orchestration guards — skip non-routable
 *     events, skip the dashboard's own bookkeeping issues (self-feedback
 *     loop), gate sends to subscriptions whose `userLogin` was mentioned,
 *     broadcast `#channel` messages to all subscribers except the author,
 *     and prune 404/410 (expired) endpoints after sending.
 *
 * Every cross-module dependency is mocked at its import boundary; web-push
 * itself is faked so no network/VAPID is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    sendNotification: vi.fn().mockResolvedValue(undefined),
    setVapidDetails: vi.fn(),
    readPushManifest: vi.fn(),
    mutatePushManifest: vi.fn().mockResolvedValue(0),
    appendInboxFeed: vi.fn().mockResolvedValue(0),
    readInboxFeed: vi.fn().mockResolvedValue({ entries: [] }),
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
  readPushManifest: h.readPushManifest,
  mutatePushManifest: h.mutatePushManifest,
}));
vi.mock("@dashboard/lib/inbox/feed-server", () => ({
  appendInboxFeed: h.appendInboxFeed,
  readInboxFeed: h.readInboxFeed,
}));
vi.mock("@dashboard/lib/inbox/feed", () => ({
  feedEntryId: (login: string, url: string) => `${login}:${url}`,
  INBOX_FEED_ISSUE_TITLE: "kody:inbox-feed",
}));
vi.mock("@dashboard/lib/inbox/types", () => ({
  buildSnippet: (b: string) => b.slice(0, 80),
}));
vi.mock("@dashboard/lib/cto/recommendation", () => ({
  DEFAULT_AGENT_SLUG: "cto",
  parseCtoAction: () => undefined,
  parseCtoCommand: () => undefined,
  parseCtoAgent: () => undefined,
  parseCtoDuty: () => null,
}));
vi.mock("@dashboard/lib/cto/trust-store", () => ({
  readTrust: vi.fn().mockResolvedValue({ version: 1, duties: {}, log: [] }),
}));
vi.mock("@dashboard/lib/cto/trust-state", () => ({
  latestTrustDecisions: () => ({}),
}));
vi.mock("@dashboard/lib/cto/backpressure", () => ({
  applyCtoBackpressure: (_feed: unknown, entries: unknown[]) => ({
    admitted: entries,
    withheld: [],
  }),
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/thread-link", () => ({
  dashboardThreadUrl: () => "https://dash/thread",
  dashboardChannelUrl: () => "https://dash/messages",
}));
vi.mock("@dashboard/lib/push/vapid-keys", () => ({
  deriveVapidKeys: h.deriveVapidKeys,
}));
vi.mock("@dashboard/lib/push", () => ({
  PUSH_MANIFEST_ISSUE_TITLE: "kody:push-subscriptions",
}));
vi.mock("@dashboard/lib/control-issue", () => ({
  CONTROL_TITLE: "kody:control",
}));
vi.mock("@dashboard/lib/vault/bootstrap", () => ({
  resolveVaultGithubToken: vi.fn().mockResolvedValue("bot-token"),
}));

import {
  extractMentions,
  dispatchMentionPushes,
} from "@dashboard/lib/push/mention-dispatch";

function sub(userLogin: string, extra: Record<string, unknown> = {}) {
  return {
    endpoint: `https://push/${userLogin}`,
    keys: { p256dh: "p", auth: "a" },
    userLogin,
    ...extra,
  };
}

function issuesEvent(body: string, title = "Some task") {
  return {
    action: "opened",
    repository: { full_name: "acme/widgets" },
    issue: {
      body,
      title,
      user: { login: "author" },
      html_url: "https://gh/i/1",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sendNotification.mockResolvedValue(undefined);
  h.readPushManifest.mockResolvedValue({ manifest: { subscriptions: [] } });
  process.env.GITHUB_TOKEN = "bot-token";
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe("extractMentions", () => {
  it("extracts, lower-cases, and de-dupes logins", () => {
    expect(extractMentions("hi @Alice and @bob, also @Alice")).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("handles hyphenated logins", () => {
    expect(extractMentions("ping @octo-cat")).toEqual(["octo-cat"]);
  });

  it("returns [] for empty/null bodies", () => {
    expect(extractMentions("")).toEqual([]);
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions(undefined)).toEqual([]);
  });

  it("does not treat an email address as a mention", () => {
    expect(extractMentions("reach me at user@example.com")).toEqual([]);
  });

  it("matches a mention at the very start of the body", () => {
    expect(extractMentions("@lead please review")).toEqual(["lead"]);
  });

  it("ignores the bot's own command handle (bare orchestrator triggers)", () => {
    // Exempt orchestrator trigger comments carry a literal @kody; they are
    // commands, not pings. Recording them flooded the shared inbox feed.
    expect(extractMentions("@kody bug --base 1979-foo")).toEqual([]);
    expect(extractMentions("@kody sync --pr 1573")).toEqual([]);
    expect(extractMentions("@kodyade did the work")).toEqual([]);
  });

  it("ignores mentions inside inline code and fenced blocks", () => {
    // GitHub doesn't notify for @mentions inside code; neither do we.
    expect(
      extractMentions("Confirming will run `@kody sync --pr 1573`."),
    ).toEqual([]);
    expect(extractMentions("```\n@kody resolve --pr 1574\n```")).toEqual([]);
  });

  it("still records a real operator mention alongside a quoted command", () => {
    // CTO/QA comment that pings the operator but quotes the @kody command:
    // the human mention survives, the bot command is dropped.
    expect(
      extractMentions("@aguyaharonyair please run `@kody sync --pr 1573`"),
    ).toEqual(["aguyaharonyair"]);
  });
});

describe("dispatchMentionPushes", () => {
  it("skips events that aren't routable", async () => {
    await dispatchMentionPushes("star", {
      repository: { full_name: "acme/widgets" },
    });
    expect(h.readPushManifest).not.toHaveBeenCalled();
  });

  it("skips the dashboard's own bookkeeping issues (self-feedback loop)", async () => {
    await dispatchMentionPushes(
      "issues",
      issuesEvent("@alice look", "kody:inbox-feed"),
    );
    expect(h.readPushManifest).not.toHaveBeenCalled();
  });

  it("sends nothing when the body has no @mentions", async () => {
    h.readPushManifest.mockResolvedValue({
      manifest: { subscriptions: [sub("alice")] },
    });
    await dispatchMentionPushes(
      "issues",
      issuesEvent("plain text, nobody tagged"),
    );
    expect(h.sendNotification).not.toHaveBeenCalled();
  });

  it("pushes only to subscriptions whose login was mentioned", async () => {
    h.readPushManifest.mockResolvedValue({
      manifest: { subscriptions: [sub("alice"), sub("bob")] },
    });
    await dispatchMentionPushes("issues", issuesEvent("hey @alice"));

    expect(h.sendNotification).toHaveBeenCalledTimes(1);
    expect(h.sendNotification.mock.calls[0][0].endpoint).toBe(
      "https://push/alice",
    );
  });

  it("prunes expired (410) endpoints after a failed send", async () => {
    h.readPushManifest.mockResolvedValue({
      manifest: { subscriptions: [sub("alice")] },
    });
    h.sendNotification.mockRejectedValueOnce(new h.WebPushError("gone", 410));

    await dispatchMentionPushes("issues", issuesEvent("yo @alice"));

    expect(h.mutatePushManifest).toHaveBeenCalledTimes(1);
  });

  it("broadcasts a #channel message to all subscribers except the author", async () => {
    h.readPushManifest.mockResolvedValue({
      manifest: {
        subscriptions: [sub("alice"), sub("bob"), sub("carol")],
      },
    });
    const channelEvent = {
      action: "created",
      repository: { full_name: "acme/widgets" },
      discussion: { number: 5, title: "#general" },
      comment: {
        body: "deploy is green",
        id: 99,
        user: { login: "carol" },
        html_url: "u",
      },
    };

    await dispatchMentionPushes("discussion_comment", channelEvent);

    // carol authored it → excluded; alice + bob get the broadcast.
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    const endpoints = h.sendNotification.mock.calls
      .map((c) => c[0].endpoint)
      .sort();
    expect(endpoints).toEqual(["https://push/alice", "https://push/bob"]);
  });

  it("respects the per-subscription channelNotify=off opt-out", async () => {
    h.readPushManifest.mockResolvedValue({
      manifest: {
        subscriptions: [sub("alice", { channelNotify: "off" }), sub("bob")],
      },
    });
    const channelEvent = {
      action: "created",
      repository: { full_name: "acme/widgets" },
      discussion: { number: 5, title: "#general" },
      comment: { body: "ping", id: 1, user: { login: "carol" }, html_url: "u" },
    };

    await dispatchMentionPushes("discussion_comment", channelEvent);

    expect(h.sendNotification).toHaveBeenCalledTimes(1);
    expect(h.sendNotification.mock.calls[0][0].endpoint).toBe(
      "https://push/bob",
    );
  });

  it("never throws even when the manifest read fails", async () => {
    h.readPushManifest.mockRejectedValue(new Error("github down"));
    await expect(
      dispatchMentionPushes("issues", issuesEvent("@alice")),
    ).resolves.toBeUndefined();
  });
});
