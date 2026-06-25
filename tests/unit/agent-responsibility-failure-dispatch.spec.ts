/**
 * Unit tests for the failed-agentResponsibility → inbox fan-out
 * (src/dashboard/lib/push/agent-responsibility-failure-dispatch.ts). A agentResponsibility that fails on a
 * scheduled tick has no issue to comment on and the engine has no operator
 * list, so the failure used to be silent in both the inbox and push. This
 * module turns the engine's activity-log commit (a state-repo `push`) into
 * one inbox-feed entry per operator.
 *
 * Two layers under test:
 *   - `touchesActivityLog` / `buildEntries`: the pure correctness core
 *     (which pushes we react to, and the entries we synthesize).
 *   - `dispatchAgentResponsibilityFailures`: the orchestration guards — ignore non-routable
 *     pushes, skip when no operators / no token / no failures, and append
 *     one entry per (operator × failed record) otherwise.
 *
 * Every cross-module dependency is mocked at its import boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  createUserOctokit: vi.fn(() => ({}) as unknown),
  fetchCompanyActivity: vi.fn(),
  readOperators: vi.fn(),
  resolveVaultGithubToken: vi.fn(),
  appendInboxFeed: vi.fn().mockResolvedValue(0),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
  createUserOctokit: h.createUserOctokit,
  fetchCompanyActivity: h.fetchCompanyActivity,
}));
vi.mock("@dashboard/lib/engine/config", () => ({
  readOperators: h.readOperators,
}));
vi.mock("@dashboard/lib/vault/bootstrap", () => ({
  resolveVaultGithubToken: h.resolveVaultGithubToken,
}));
vi.mock("@dashboard/lib/inbox/feed-server", () => ({
  appendInboxFeed: h.appendInboxFeed,
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  touchesActivityLog,
  buildEntries,
  dispatchAgentResponsibilityFailures,
} from "@dashboard/lib/push/agent-responsibility-failure-dispatch";
import type { CompanyActivityRecord } from "@dashboard/lib/activity/company";

function rec(over: Partial<CompanyActivityRecord> = {}): CompanyActivityRecord {
  return {
    ts: new Date().toISOString(),
    action: "Ran agentResponsibility: Verify changelog",
    agentResponsibility: "changelog-verify",
    agentResponsibilityTitle: "Verify changelog",
    agent: "qa-engineer",
    staffTitle: "QA Engineer",
    trigger: "schedule",
    outcome: "failed",
    outcomeKind: null,
    reason: null,
    durationMs: 1234,
    runUrl: "https://github.com/acme/widgets/actions/runs/42",
    ...over,
  };
}

function pushEvent(ref: string, files: string[]) {
  return {
    ref,
    repository: { full_name: "acme/widgets" },
    commits: [{ added: files, modified: [] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveVaultGithubToken.mockResolvedValue("bot-token");
  h.readOperators.mockResolvedValue(["alice", "bob"]);
  h.appendInboxFeed.mockResolvedValue(0);
});

describe("touchesActivityLog", () => {
  it("matches a state-repo push that adds an activity day-file", () => {
    expect(
      touchesActivityLog(
        pushEvent("refs/heads/kody-state", [
          "widgets/activity/2026-05-23.jsonl",
        ]),
      ),
    ).toBe(true);
  });

  it("matches a state-repo push that modifies an activity day-file", () => {
    expect(
      touchesActivityLog({
        ref: "refs/heads/kody-state",
        commits: [
          { added: [], modified: ["widgets/activity/2026-05-23.jsonl"] },
        ],
      }),
    ).toBe(true);
  });

  it("ignores a state-repo push that touches unrelated files", () => {
    expect(
      touchesActivityLog(
        pushEvent("refs/heads/kody-state", ["widgets/events/live-1.jsonl"]),
      ),
    ).toBe(false);
  });

  it("matches activity-file changes by state-repo path regardless branch", () => {
    expect(
      touchesActivityLog(
        pushEvent("refs/heads/main", ["widgets/activity/2026-05-23.jsonl"]),
      ),
    ).toBe(true);
  });

  it("ignores a payload with no ref (not a push)", () => {
    expect(touchesActivityLog({ commits: [] })).toBe(false);
  });
});

describe("buildEntries", () => {
  it("emits one entry per (operator × failure) with a deterministic id", () => {
    const failure = rec({
      agentResponsibility: "d1",
      ts: "2026-05-23T00:00:00.000Z",
    });
    const entries = buildEntries(
      "acme",
      "widgets",
      ["alice", "bob"],
      [failure],
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual([
      "agentResponsibility-fail:alice:d1:2026-05-23T00:00:00.000Z",
      "agentResponsibility-fail:bob:d1:2026-05-23T00:00:00.000Z",
    ]);
    expect(entries[0]).toMatchObject({
      login: "alice",
      source: "other",
      repoFullName: "acme/widgets",
      threadType: "Run",
      title: "AgentResponsibility failed: Verify changelog",
      url: "https://github.com/acme/widgets/actions/runs/42",
    });
  });

  it("puts the failure reason in the snippet from outcomeKind", () => {
    const entries = buildEntries(
      "acme",
      "widgets",
      ["alice"],
      [rec({ outcomeKind: "model_error" })],
    );
    expect(entries[0].snippet).toBe("QA Engineer — model error");
  });

  it("falls back to the raw reason text when outcomeKind is unmapped", () => {
    const entries = buildEntries(
      "acme",
      "widgets",
      ["alice"],
      [rec({ outcomeKind: "generic_failed", reason: "boom: kaput" })],
    );
    expect(entries[0].snippet).toBe("QA Engineer — boom: kaput");
  });

  it("labels stopped-early kinds differently from a real failure", () => {
    const entries = buildEntries(
      "acme",
      "widgets",
      ["alice"],
      [rec({ outcomeKind: "out_of_turns" })],
    );
    expect(entries[0].title).toBe(
      "AgentResponsibility stopped early: Verify changelog",
    );
    expect(entries[0].snippet).toBe("QA Engineer — agent hit its turn limit");
  });

  it("keeps the generic 'failed' wording for older records (no kind)", () => {
    const entries = buildEntries("acme", "widgets", ["alice"], [rec()]);
    expect(entries[0].title).toBe(
      "AgentResponsibility failed: Verify changelog",
    );
    expect(entries[0].snippet).toBe("QA Engineer — run failed");
  });

  it("falls back to the repo URL when the run URL is missing", () => {
    const entries = buildEntries(
      "acme",
      "widgets",
      ["alice"],
      [rec({ runUrl: null })],
    );
    expect(entries[0].url).toBe("https://github.com/acme/widgets");
  });

  it("emits nothing when there are no operators", () => {
    expect(buildEntries("acme", "widgets", [], [rec()])).toHaveLength(0);
  });
});

describe("dispatchAgentResponsibilityFailures", () => {
  it("ignores non-push events", async () => {
    await dispatchAgentResponsibilityFailures("issue_comment", {
      action: "created",
    });
    expect(h.resolveVaultGithubToken).not.toHaveBeenCalled();
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("ignores pushes without activity state paths", async () => {
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/main", ["widgets/events/live-1.jsonl"]),
    );
    expect(h.resolveVaultGithubToken).not.toHaveBeenCalled();
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("appends one entry per operator for each failed record", async () => {
    h.fetchCompanyActivity.mockResolvedValue([
      rec({ agentResponsibility: "d1" }),
      rec({ agentResponsibility: "d2", outcome: "completed" }),
    ]);
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/kody-state", ["widgets/activity/2026-05-23.jsonl"]),
    );
    expect(h.appendInboxFeed).toHaveBeenCalledTimes(1);
    const entries = h.appendInboxFeed.mock.calls[0][0];
    // 1 failed record × 2 operators; the completed record is skipped.
    expect(entries).toHaveLength(2);
    expect(entries.map((e: { login: string }) => e.login).sort()).toEqual([
      "alice",
      "bob",
    ]);
    expect(h.clearGitHubContext).toHaveBeenCalled();
  });

  it("does nothing when no operators are configured", async () => {
    h.readOperators.mockResolvedValue([]);
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/kody-state", ["widgets/activity/2026-05-23.jsonl"]),
    );
    expect(h.fetchCompanyActivity).not.toHaveBeenCalled();
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("does nothing when there is no vault token", async () => {
    h.resolveVaultGithubToken.mockResolvedValue(null);
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/kody-state", ["widgets/activity/2026-05-23.jsonl"]),
    );
    expect(h.readOperators).not.toHaveBeenCalled();
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("does not append when every recent record succeeded", async () => {
    h.fetchCompanyActivity.mockResolvedValue([rec({ outcome: "completed" })]);
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/kody-state", ["widgets/activity/2026-05-23.jsonl"]),
    );
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("skips stale failures older than the lookback window", async () => {
    h.fetchCompanyActivity.mockResolvedValue([
      rec({ ts: "2000-01-01T00:00:00.000Z" }),
    ]);
    await dispatchAgentResponsibilityFailures(
      "push",
      pushEvent("refs/heads/kody-state", ["widgets/activity/2026-05-23.jsonl"]),
    );
    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });
});
