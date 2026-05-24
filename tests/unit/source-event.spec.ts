/**
 * Unit tests for the shared webhook normalizer
 * (src/dashboard/lib/notifications/source-event.ts). This is the single
 * source of truth that the mention/inbox, rules, and staff spines all parse
 * through, so its field extraction (body, author, url, title, number,
 * threadType, channel, pr block, authorIsBot) must be exact.
 */
import { describe, it, expect } from "vitest";
import { buildSourceEvent } from "@dashboard/lib/notifications/source-event";

const repo = { full_name: "acme/widgets", name: "widgets", owner: { login: "acme" } };

describe("buildSourceEvent", () => {
  it("returns null for an unknown event type", () => {
    expect(buildSourceEvent("star", { repository: repo })).toBeNull();
  });

  it("returns null when the repository is missing", () => {
    expect(buildSourceEvent("issues", { action: "opened" })).toBeNull();
  });

  it("derives repoFullName from owner/name when full_name is absent", () => {
    const ev = buildSourceEvent("issues", {
      action: "opened",
      repository: { name: "widgets", owner: { login: "acme" } },
      issue: { number: 7, title: "t", body: "b", html_url: "u", user: { login: "alice" } },
    });
    expect(ev?.repoFullName).toBe("acme/widgets");
    expect(ev?.owner).toBe("acme");
    expect(ev?.repo).toBe("widgets");
  });

  it("normalizes an issue_comment (Issue thread, number from issue)", () => {
    const ev = buildSourceEvent("issue_comment", {
      action: "created",
      repository: repo,
      issue: { number: 12, title: "Bug", pull_request: undefined },
      comment: { body: "hi @bob", html_url: "https://gh/c/1", user: { login: "alice", type: "User" } },
    });
    expect(ev).toMatchObject({
      eventType: "issue_comment",
      action: "created",
      threadType: "Issue",
      number: 12,
      body: "hi @bob",
      author: "alice",
      authorIsBot: false,
      url: "https://gh/c/1",
      title: "Bug",
    });
  });

  it("treats an issue_comment on a PR as a PullRequest thread", () => {
    const ev = buildSourceEvent("issue_comment", {
      action: "created",
      repository: repo,
      issue: { number: 12, title: "Feature", pull_request: { url: "x" } },
      comment: { body: "lgtm", html_url: "u", user: { login: "alice" } },
    });
    expect(ev?.threadType).toBe("PullRequest");
  });

  it("anchors a pull_request_review_comment to the PR number", () => {
    const ev = buildSourceEvent("pull_request_review_comment", {
      action: "created",
      repository: repo,
      pull_request: { number: 99, title: "PR" },
      comment: { body: "nit", html_url: "u", user: { login: "rev" } },
    });
    expect(ev?.threadType).toBe("PullRequest");
    expect(ev?.number).toBe(99);
  });

  it("leaves commit_comment with no thread number", () => {
    const ev = buildSourceEvent("commit_comment", {
      action: "created",
      repository: repo,
      comment: { body: "note", html_url: "u", user: { login: "alice" } },
    });
    expect(ev?.threadType).toBe("Commit");
    expect(ev?.number).toBeUndefined();
  });

  it("populates the pr block and bot flag on a pull_request event", () => {
    const ev = buildSourceEvent("pull_request", {
      action: "closed",
      repository: repo,
      pull_request: {
        number: 5,
        merged: true,
        title: "deploy: dev → main (v1.2.3)",
        body: "ship it",
        html_url: "https://gh/pr/5",
        user: { login: "kody[bot]", type: "Bot" },
      },
    });
    expect(ev?.threadType).toBe("PullRequest");
    expect(ev?.number).toBe(5);
    expect(ev?.authorIsBot).toBe(true);
    expect(ev?.pr).toEqual({
      number: 5,
      merged: true,
      title: "deploy: dev → main (v1.2.3)",
      body: "ship it",
      url: "https://gh/pr/5",
      author: "kody[bot]",
    });
  });

  it("flags a #-titled discussion_comment as a channel message", () => {
    const ev = buildSourceEvent("discussion_comment", {
      action: "created",
      repository: repo,
      discussion: { number: 3, title: "#general" },
      comment: { body: "deploy green", id: 42, html_url: "u", user: { login: "carol" } },
    });
    expect(ev?.channel).toEqual({ number: 3, commentId: 42 });
    expect(ev?.number).toBe(3);
  });

  it("does not flag a normal-titled discussion_comment as a channel", () => {
    const ev = buildSourceEvent("discussion_comment", {
      action: "created",
      repository: repo,
      discussion: { number: 3, title: "Roadmap" },
      comment: { body: "thoughts", id: 42, html_url: "u", user: { login: "carol" } },
    });
    expect(ev?.channel).toBeUndefined();
  });

  it("carries the raw action without gating (rules spine needs closed)", () => {
    const ev = buildSourceEvent("pull_request", {
      action: "closed",
      repository: repo,
      pull_request: { number: 5, merged: true, title: "x", html_url: "u" },
    });
    // The normalizer never filters on action — consumers do.
    expect(ev?.action).toBe("closed");
  });
});
