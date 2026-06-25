/**
 * @fileoverview Reproduction + regression test for the "vibe handoff runs but
 * nothing happens / chat sits silent" bug.
 * @testFramework vitest
 * @domain vibe
 *
 * ROOT CAUSE (found from real session files): the handoff writes the runner's
 * session JSONL in TWO separate GitHub writes — `/interactive/start` writes
 * the meta line, then `/interactive/append` writes the first user turn. Those
 * two writes race on the same file/branch HEAD, and the append's turn is
 * frequently lost — the session ends up meta-only. The runner then boots,
 * finds no turn, waits, and idle-exits with turnsCompleted:0. The chat shows
 * a "processing…" spinner the whole time, so it looks stuck and the task
 * never runs.
 *
 * FIX: let `/interactive/start` write the meta line AND the first user turn in
 * ONE atomic file write, so the runner always sees the kickoff turn on its
 * first read — no second write to race with.
 *
 * This test drives the start route with an initial `content` and asserts the
 * committed session file contains the user turn. It fails on the old route
 * (meta-only) and passes once start writes the turn atomically.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { POST as startPOST } from "../../app/api/kody/chat/interactive/start/route";

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function mockRepoConfig404(): void {
  nock(GITHUB_API)
    .get("/repos/acme/widgets/contents/kody.config.json")
    .reply(404);
}

function sessionPath(sessionId: string): string {
  return `/repos/acme/kody-state/contents/widgets%2Fsessions%2F${sessionId}.jsonl`;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/interactive/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

/** Capture the JSONL committed to the session file (decoded from the PUT). */
function captureSessionWrite(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    nock(GITHUB_API)
      .get(sessionPath(sessionId))
      .reply(404)
      .put(sessionPath(sessionId), (payload: { content: string }) => {
        resolve(Buffer.from(payload.content, "base64").toString("utf-8"));
        return true;
      })
      .reply(201, { content: { sha: "newsha" } });
    // The workflow dispatch that follows the session write.
    nock(GITHUB_API)
      .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
      .reply(204);
  });
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "interactive-start-test-secret";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

beforeEach(() => {
  mockRepoConfig404();
});

afterEach(() => {
  nock.cleanAll();
});

describe("POST /api/kody/chat/interactive/start — atomic initial turn", () => {
  it("writes the first user turn INTO the session file alongside meta (no separate append to race)", async () => {
    const written = captureSessionWrite("vibe-42-abc");

    const res = await startPOST(
      makeRequest({
        taskId: "vibe-42-abc",
        content: "Implement issue #42 now. Plan was approved.",
        vibeMode: true,
        taskContext: { issueNumber: 42, branch: "42-fix" },
      }),
    );
    expect(res.status).toBe(200);

    const jsonl = await written;
    const lines = jsonl
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    // Line 1 is the interactive meta marker.
    expect(lines[0]).toMatchObject({ type: "meta", mode: "interactive" });

    // Line 2 MUST be the first user turn — this is what was being lost.
    const userTurn = lines.find((l) => l.role === "user");
    expect(
      userTurn,
      "start must persist the first user turn atomically with meta — " +
        "otherwise the runner boots to an empty session and idle-exits (the silent-chat bug)",
    ).toBeTruthy();
    expect(userTurn.content).toContain(
      "Implement issue #42 now. Plan was approved.",
    );
    // vibeMode → the server-only vibe primer rides along with the turn.
    expect(userTurn.content).toContain("[Vibe mode");
    expect(userTurn.content).toContain("Use the existing branch `42-fix`");
  });

  it("still writes a meta-only session when no initial content is given (back-compat)", async () => {
    const written = captureSessionWrite("plain-1");

    const res = await startPOST(makeRequest({ taskId: "plain-1" }));
    expect(res.status).toBe(200);

    const jsonl = await written;
    const lines = jsonl
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "meta", mode: "interactive" });
  });
});
