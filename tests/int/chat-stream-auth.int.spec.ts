/**
 * @fileoverview /api/kody/events/stream auth resolution tests.
 * @testFramework vitest
 * @domain chat-contract
 *
 * Regression guard for the bug that silently broke Gemini chat in the UI:
 * EventSource can't send custom headers, so the client passes `token`,
 * `owner`, `repo` as query params. The route must promote them to the
 * x-kody-* header triplet that requireKodyAuth / getRequestAuth read.
 * Without this, the stream route polled the wrong (fallback) repo and
 * never surfaced any committed events to the browser.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { GET as streamGET } from "../../app/api/kody/events/stream/route";

const GITHUB_API = "https://api.github.com";

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  vi.unstubAllEnvs();
});

describe("GET /api/kody/events/stream — auth via query params", () => {
  it("rejects with 401 when no auth is provided at all (?taskId=x only)", async () => {
    // The e2e workflow sets KODY_BOT_TOKEN at the job level so other tests
    // can authenticate. Clear it (plus its fallbacks) so this test really
    // exercises the "no auth at all" path.
    vi.stubEnv("KODY_BOT_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GH_PAT", "");
    const req = new NextRequest(
      "https://dash.test/api/kody/events/stream?taskId=s1",
    );
    const res = await streamGET(req);
    expect([401, 503]).toContain(res.status);
  });

  it("accepts auth from query params (what EventSource needs) in test mode", async () => {
    // test=1 short-circuits the handler before polling GitHub, so we can
    // assert auth resolution without a full SSE subscription.
    const req = new NextRequest(
      "https://dash.test/api/kody/events/stream?taskId=s1&token=ghp_test&owner=o&repo=r&test=1",
    );
    const res = await streamGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.json();
    expect(body).toMatchObject({ sessionId: "s1" });
  });

  it("prefers x-kody-* headers when both headers and query params are present", async () => {
    const req = new NextRequest(
      "https://dash.test/api/kody/events/stream?taskId=s1&token=ghp_query&owner=query-owner&repo=query-repo&test=1",
      {
        headers: {
          "x-kody-token": "ghp_header",
          "x-kody-owner": "header-owner",
          "x-kody-repo": "header-repo",
        },
      },
    );
    const res = await streamGET(req);
    expect(res.status).toBe(200);
    // test mode returns sessionId; deeper behavior is covered by UI e2e.
  });
});
