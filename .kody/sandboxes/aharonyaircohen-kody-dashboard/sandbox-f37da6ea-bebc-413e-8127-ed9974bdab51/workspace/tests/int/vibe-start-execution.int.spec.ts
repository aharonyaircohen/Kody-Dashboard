/**
 * @fileoverview Integration tests for the `vibe_start_execution` chat tool —
 * the server-side hand-off at the heart of the vibe flow.
 * @testFramework vitest
 * @domain vibe
 *
 * This is the boundary where the historically painful vibe bugs lived:
 * "issue created, PR opened, but the runner never edits / the PR is empty."
 * The tool's job is to (1) get-or-create the vibe branch, (2) sync a reused
 * branch with base, (3) find-or-create the draft PR, and (4) return a
 * SwitchAgentDirective that the dashboard's stream parser uses to flip the
 * active agent AND auto-kick-off the runner. If any field of that directive
 * drifts, the UI silently stops handing off — exactly the symptom we keep
 * hitting in production.
 *
 * Strategy: inject a `BranchService` backed by the shared in-memory
 * `FakeBranchRepo` (the same fixture the BranchService int tests use). This
 * exercises the REAL orchestration in vibe-tools.ts — the error→code
 * mapping, the conflict early-return, and the exact directive shape — with
 * no GitHub network, no LLM, and no real runner.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { createVibeTools } from "../../app/api/kody/chat/tools/vibe-tools";
import { BranchService } from "@dashboard/lib/branches/application/branch-service";
import { SWITCH_AGENT_DIRECTIVE } from "@dashboard/lib/chat-ui-actions";
import { FakeBranchRepo, FakeLock } from "../helpers/fake-branch-repo";

/**
 * Run the `vibe_start_execution` tool against an injected BranchService.
 * `octokit` is never touched on this path (the service is injected), so a
 * bare cast is safe — invalidateIssueCache is an in-memory no-op.
 */
async function runTool(
  svc: BranchService,
  input: {
    issueNumber: number;
    slug?: string;
    targetAgent: "kody-live" | "kody-live-fly";
  },
) {
  const tools = createVibeTools({
    octokit: {} as unknown as Octokit,
    owner: "acme",
    repo: "widgets",
    branches: svc,
  });
  // The AI SDK `tool()` wrapper exposes the handler as `.execute`.
  const exec = (
    tools.vibe_start_execution as unknown as {
      execute: (i: typeof input) => Promise<Record<string, unknown>>;
    }
  ).execute;
  return exec(input);
}

describe("vibe_start_execution — happy path (fresh branch)", () => {
  let repo: FakeBranchRepo;
  let svc: BranchService;

  beforeEach(() => {
    repo = new FakeBranchRepo();
    svc = new BranchService(repo, new FakeLock());
  });

  it("creates the branch + draft PR and returns a complete switch-agent directive", async () => {
    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    // The directive shape the dashboard stream parser keys on.
    expect(out.action).toBe(SWITCH_AGENT_DIRECTIVE);
    expect(out.agentId).toBe("kody-live");
    expect(out.agentName).toBe("Kody Live");
    expect(out.branch).toBe("42-fix-the-thing");
    expect(out.reused).toBe(false);
    expect(typeof out.prNumber).toBe("number");
    expect(String(out.prUrl)).toMatch(/^https?:\/\//);
    expect(out.error).toBeUndefined();

    // A draft PR was actually opened on the new branch.
    expect(repo.calls.createDraftPR).toBe(1);
    expect(repo.openPRs.get("42-fix-the-thing")?.length).toBe(1);
  });

  it("emits an autoKickoff gated to THIS issue (prevents dispatching the wrong session)", async () => {
    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    // autoKickoff is what tells the runner to actually start. Missing/blank
    // here = the "empty PR, runner idle" production bug.
    expect(typeof out.autoKickoff).toBe("string");
    expect(String(out.autoKickoff)).toContain("#42");
    expect(String(out.autoKickoff)).toMatch(/do not ask for confirmation/i);
    // The kickoff must be gated to issue 42 so the client useEffect can't
    // fire it against a stale, previously-viewed issue scope.
    expect(out.autoKickoffIssueNumber).toBe(42);
  });

  it("opens the PR body with a Closes-link so the dashboard can pair PR↔issue", async () => {
    // Capture the body the tool passes to findOrCreateDraftPR.
    let capturedBody = "";
    const origCreate = repo.createDraftPR.bind(repo);
    repo.createDraftPR = async (input) => {
      capturedBody = input.body;
      return origCreate(input);
    };

    await runTool(svc, { issueNumber: 42, targetAgent: "kody-live" });
    expect(capturedBody).toContain("Closes #42");
  });

  it("maps targetAgent=kody-live-fly to the Fly runner + its display name", async () => {
    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live-fly",
    });
    expect(out.agentId).toBe("kody-live-fly");
    expect(out.agentName).toBe("Kody Live (Fly)");
  });
});

describe("vibe_start_execution — idempotent reuse", () => {
  it("reuses an existing Kody-owned branch + draft PR instead of opening a second", async () => {
    const repo = new FakeBranchRepo();
    // Pre-seed: a Kody-owned branch for #42 with an already-open draft PR.
    repo.branches.set("42-fix-the-thing", {
      sha: "sha-existing",
      commitMessages: ["vibe: start session for #42"],
    });
    repo.openPRs.set("42-fix-the-thing", [
      { number: 7, htmlUrl: "https://example.test/pr/7" },
    ]);
    // A reused branch gets synced with base first; keep it a clean no-op.
    repo.compareResult = { status: "identical", mergeBaseSha: "sha-main" };
    const svc = new BranchService(repo, new FakeLock());

    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    expect(out.reused).toBe(true);
    expect(out.prNumber).toBe(7);
    expect(out.action).toBe(SWITCH_AGENT_DIRECTIVE);
    // No NEW PR opened — the existing one was reused.
    expect(repo.calls.createDraftPR).toBe(0);
    // autoKickoff is still emitted on reuse so a re-run still drives the runner.
    expect(typeof out.autoKickoff).toBe("string");
  });
});

describe("vibe_start_execution — error mapping (no directive, structured codes)", () => {
  it("returns code=foreign_branch when a same-named branch is not Kody-owned", async () => {
    const repo = new FakeBranchRepo();
    // Pre-existing human branch with the same slug, NO Kody marker.
    repo.branches.set("42-fix-the-thing", {
      sha: "sha-human",
      commitMessages: ["feat: human work"],
    });
    const svc = new BranchService(repo, new FakeLock());

    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    expect(out.code).toBe("foreign_branch");
    expect(out.branch).toBe("42-fix-the-thing");
    // It must NOT pretend a hand-off happened.
    expect(out.action).toBeUndefined();
    expect(repo.calls.createDraftPR).toBe(0);
  });

  it("returns code=session_in_progress when the issue lock is already held", async () => {
    const repo = new FakeBranchRepo();
    const lock = new FakeLock();
    lock.available = false; // another vibe session holds the lease
    const svc = new BranchService(repo, lock);

    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    expect(out.code).toBe("session_in_progress");
    expect(out.action).toBeUndefined();
  });

  it("returns a conflict error (no directive) when a reused branch can't be synced", async () => {
    const repo = new FakeBranchRepo();
    repo.branches.set("42-fix-the-thing", {
      sha: "sha-existing",
      commitMessages: ["vibe: start session for #42"],
    });
    // Reused branch has diverged and the merge hits a conflict.
    repo.compareResult = { status: "diverged", mergeBaseSha: "sha-merge-base" };
    repo.mergeResult = {
      kind: "conflict",
      message: "Merge conflict in foo.ts",
    };
    const svc = new BranchService(repo, new FakeLock());

    const out = await runTool(svc, {
      issueNumber: 42,
      targetAgent: "kody-live",
    });

    expect(String(out.error)).toMatch(/conflict/i);
    expect(out.action).toBeUndefined();
    // We bailed before opening a PR on a conflicted branch.
    expect(repo.calls.createDraftPR).toBe(0);
  });

  it("returns a plain error (no directive) when the issue number is actually a PR", async () => {
    const repo = new FakeBranchRepo(); // issue #99 is seeded as a PR
    const svc = new BranchService(repo, new FakeLock());

    const out = await runTool(svc, {
      issueNumber: 99,
      targetAgent: "kody-live",
    });

    expect(String(out.error)).toMatch(/pull request/i);
    expect(out.action).toBeUndefined();
  });
});

describe("vibe_start_execution — scoped to a current task", () => {
  // Reproduction for the live failure: in the two-turn flow (create issue,
  // then approve while scoped to it), the model sometimes calls
  // vibe_start_execution with a WRONG/hallucinated issueNumber (observed: it
  // passed #37 while the user was on #3513). The handoff then targets the
  // wrong issue, and the client kickoff gate (which only fires when the
  // directive's issue matches the viewed one) blocks dispatch — so the
  // runner never starts. When the chat is scoped to a current task, the tool
  // must hand off THAT issue, not whatever number the model guessed.
  function runScoped(
    svc: BranchService,
    currentIssueNumber: number,
    input: { issueNumber: number; targetAgent: "kody-live" | "kody-live-fly" },
  ) {
    const tools = createVibeTools({
      octokit: {} as unknown as Octokit,
      owner: "acme",
      repo: "widgets",
      branches: svc,
      currentIssueNumber,
    });
    const exec = (
      tools.vibe_start_execution as unknown as {
        execute: (i: typeof input) => Promise<Record<string, unknown>>;
      }
    ).execute;
    return exec(input);
  }

  it("hands off the CURRENT task's issue, not a mismatched number from the model", async () => {
    const repo = new FakeBranchRepo();
    // A different, valid issue the model might mistakenly name.
    repo.issues.set(5, { title: "Some other issue", isPullRequest: false });
    const svc = new BranchService(repo, new FakeLock());

    // User is scoped to #42; the model wrongly passes #5.
    const out = await runScoped(svc, 42, {
      issueNumber: 5,
      targetAgent: "kody-live-fly",
    });

    // Must execute the issue the user is actually on (#42).
    expect(out.branch).toBe("42-fix-the-thing");
    expect(out.autoKickoffIssueNumber).toBe(42);
    expect(String(out.autoKickoff)).toContain("#42");
    expect(String(out.autoKickoff)).not.toContain("#5");
    // It must NOT have touched the wrongly-named issue.
    expect(repo.branches.has("5-some-other-issue")).toBe(false);
  });

  it("falls back to the model's issueNumber when there is no current scope (fresh single-turn flow)", async () => {
    const repo = new FakeBranchRepo();
    const svc = new BranchService(repo, new FakeLock());
    const tools = createVibeTools({
      octokit: {} as unknown as Octokit,
      owner: "acme",
      repo: "widgets",
      branches: svc,
      // no currentIssueNumber
    });
    const exec = (
      tools.vibe_start_execution as unknown as {
        execute: (i: {
          issueNumber: number;
          targetAgent: string;
        }) => Promise<Record<string, unknown>>;
      }
    ).execute;
    const out = await exec({ issueNumber: 42, targetAgent: "kody-live" });
    expect(out.autoKickoffIssueNumber).toBe(42);
    expect(out.branch).toBe("42-fix-the-thing");
  });
});
