/**
 * @fileoverview Fly-path twin of interactive-start-initial-turn.int.spec.ts.
 * @testFramework vitest
 * @domain vibe
 *
 * The "vibe handoff runs but nothing happens" fix folds the first user turn
 * into the same commit as the session meta line, so the runner sees it on its
 * first read (no racy follow-up /interactive/append). The Actions `start`
 * route is covered by its own test — but Vibe mostly runs on the FLY path
 * (`kody-live-fly` → /interactive/start-fly), which has the identical fold.
 * This pins that path: a pool claim must not skip the turn write.
 *
 * The pool client + Fly context are module-mocked (nothing boots); the octokit
 * in the mocked context captures the session-file PUT so we can assert the
 * committed JSONL contains meta + the primed user turn.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { NextRequest } from "next/server";

const claimFromPool = vi.fn();
const spawnRunner = vi.fn();
const resolveFlyContext = vi.fn();

vi.mock("@dashboard/lib/runners/pool-client", () => ({
  claimFromPool: (...args: unknown[]) => claimFromPool(...args),
}));
vi.mock("@dashboard/lib/runners/fly", () => ({
  spawnRunner: (...args: unknown[]) => spawnRunner(...args),
}));
vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: (...args: unknown[]) => resolveFlyContext(...args),
}));

// Import AFTER mocks are registered.
import { POST as startFlyPOST } from "../../app/api/kody/chat/interactive/start-fly/route";

const AUTH_HEADERS = {
  "content-type": "application/json",
  "x-kody-token": "ghp_test",
  "x-kody-owner": "acme",
  "x-kody-repo": "widgets",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "https://dash.test/api/kody/chat/interactive/start-fly",
    {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

/**
 * A Fly context whose octokit captures the session-file write. getContent →
 * 404 (new file), createOrUpdateFileContents records the decoded JSONL.
 */
function capturingContext() {
  let written = "";
  const createOrUpdateFileContents = vi.fn(
    async (args: { content: string }) => {
      written = Buffer.from(args.content, "base64").toString("utf-8");
      return { data: { content: { sha: "newsha" } } };
    },
  );
  const getContent = vi.fn(async () => {
    const e = new Error("not found") as Error & { status: number };
    e.status = 404;
    throw e;
  });
  const ctx = {
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      githubToken: "ghp_test",
      octokit: { repos: { getContent, createOrUpdateFileContents } },
      allSecrets: {},
      flyToken: "fly_test",
      perfTier: "medium",
    },
  };
  return { ctx, getWritten: () => written };
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "interactive-start-fly-test-secret";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kody/chat/interactive/start-fly — atomic initial turn", () => {
  it("folds the primed first turn into the session commit even on a pool claim", async () => {
    const { ctx, getWritten } = capturingContext();
    resolveFlyContext.mockResolvedValue(ctx);
    claimFromPool.mockResolvedValue({ ok: true, machineId: "pool-m-1" });

    const res = await startFlyPOST(
      makeRequest({
        taskId: "vibe-77-fly",
        content: "Implement issue #77 now. Plan was approved.",
        vibeMode: true,
        taskContext: { issueNumber: 77, branch: "77-fix" },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, runner: "pool" });
    // Claim path must not have skipped the turn write.
    expect(spawnRunner).not.toHaveBeenCalled();

    const lines = getWritten()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "meta", mode: "interactive" });
    const userTurn = lines.find((l) => l.role === "user");
    expect(
      userTurn,
      "start-fly must persist the first user turn atomically with meta — " +
        "otherwise the Fly runner boots to an empty session and idle-exits",
    ).toBeTruthy();
    expect(userTurn.content).toContain("Implement issue #77 now.");
    // vibeMode → the server-only vibe primer rides along with the turn.
    expect(userTurn.content).toContain("[Vibe mode");
    expect(userTurn.content).toContain("Use the existing branch `77-fix`");
  });

  it("writes a meta-only session when no initial content is given (back-compat)", async () => {
    const { ctx, getWritten } = capturingContext();
    resolveFlyContext.mockResolvedValue(ctx);
    claimFromPool.mockResolvedValue({ ok: true, machineId: "pool-m-2" });

    const res = await startFlyPOST(makeRequest({ taskId: "plain-fly" }));
    expect(res.status).toBe(200);

    const lines = getWritten()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "meta", mode: "interactive" });
  });
});
