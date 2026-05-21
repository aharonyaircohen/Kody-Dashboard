/**
 * @fileoverview Integration tests for POST /api/kody/chat/interactive/append —
 * the path a follow-up vibe turn takes to a long-lived runner.
 * @testFramework vitest
 * @domain vibe
 *
 * The runner reads each user turn out of `.kody/sessions/<id>.jsonl` on its
 * next pull. The vibe primer is SERVER-ONLY (the dashboard never renders it),
 * so it must be injected here, into the turn content that gets written to the
 * session file — otherwise the runner has no idea it's in vibe mode, forgets
 * to commit/push, and re-creates a fresh branch. These tests pin that the
 * primer (a) travels with the turn when `vibeMode` is set, (b) hard-pins the
 * pre-created branch when `taskContext.branch` is present, and (c) is absent
 * for ordinary (non-vibe) interactive turns.
 *
 * GitHub is intercepted with nock — the actual JSONL the route would commit
 * is captured from the PUT body and decoded, so we assert on real output.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { POST as appendPOST } from "../../app/api/kody/chat/interactive/append/route";

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "https://dash.test/api/kody/chat/interactive/append",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "ghp_test",
        "x-kody-owner": "acme",
        "x-kody-repo": "widgets",
      },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Intercept the read (404 → new file) + write of the session JSONL and
 * return a promise that resolves with the decoded content of the appended
 * turn (the last JSONL line written in the PUT body).
 */
function captureAppendedTurn(sessionId: string): Promise<{
  role: string;
  content: string;
}> {
  return new Promise((resolve) => {
    nock(GITHUB_API)
      .get(
        new RegExp(
          `/repos/acme/widgets/contents/\\.kody.*sessions.*${sessionId}\\.jsonl`,
        ),
      )
      .query(true)
      .reply(404)
      .put(
        new RegExp(
          `/repos/acme/widgets/contents/\\.kody.*sessions.*${sessionId}\\.jsonl`,
        ),
        (payload: { content: string }) => {
          const decoded = Buffer.from(payload.content, "base64").toString(
            "utf-8",
          );
          const lines = decoded.split("\n").filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          resolve(last);
          return true;
        },
      )
      .reply(201, { content: { sha: "newsha" } });
  });
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "interactive-append-test-secret";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

afterEach(() => {
  nock.cleanAll();
});

describe("POST /api/kody/chat/interactive/append", () => {
  it("returns 400 when taskId is missing", async () => {
    const res = await appendPOST(makeRequest({ content: "hi" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /taskId/ });
  });

  it("returns 400 when content is missing", async () => {
    const res = await appendPOST(makeRequest({ taskId: "sess-1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /content/ });
  });

  it("prepends the vibe follow-up primer (branch-pinned) to the appended turn", async () => {
    const turn = captureAppendedTurn("sess-vibe-1");

    const res = await appendPOST(
      makeRequest({
        taskId: "sess-vibe-1",
        content: "make the header bigger",
        vibeMode: true,
        taskContext: { issueNumber: 42, prNumber: 101, branch: "42-header" },
      }),
    );

    expect(res.status).toBe(200);
    const written = await turn;
    expect(written.role).toBe("user");
    // Primer rode along…
    expect(written.content).toContain("[Vibe mode");
    expect(written.content).toContain("Use the existing branch `42-header`");
    expect(written.content).toContain("never end a turn with uncommitted changes");
    // …and the user's actual message survived, at the end.
    expect(written.content.endsWith("make the header bigger")).toBe(true);
  });

  it("uses gh-pr-list discovery when vibeMode is set but no branch is known", async () => {
    const turn = captureAppendedTurn("sess-vibe-2");

    const res = await appendPOST(
      makeRequest({
        taskId: "sess-vibe-2",
        content: "tweak copy",
        vibeMode: true,
        taskContext: { issueNumber: 7 },
      }),
    );

    expect(res.status).toBe(200);
    const written = await turn;
    expect(written.content).toContain('gh pr list --search "Closes #7"');
  });

  it("does NOT inject the primer for ordinary (non-vibe) interactive turns", async () => {
    const turn = captureAppendedTurn("sess-plain");

    const res = await appendPOST(
      makeRequest({ taskId: "sess-plain", content: "just a normal message" }),
    );

    expect(res.status).toBe(200);
    const written = await turn;
    expect(written.content).toBe("just a normal message");
    expect(written.content).not.toContain("[Vibe mode");
  });
});
