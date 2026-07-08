/**
 * @fileoverview Fail-open proof for the plugin-tools engine bridge
 *   (phase 2 step 1): with no plugin server tools registered, the trigger
 *   route's dispatch payload is byte-identical to the pre-bridge behavior —
 *   dashboardUrl carries ONLY the ingest token. After a plugin registers,
 *   the same dispatch gains exactly one extra `pluginTools` query param.
 * @testFramework vitest
 * @domain chat-contract
 *
 * Nock rig mirrors tests/int/chat-trigger.int.spec.ts. The server tool
 * registry is a module singleton, so the no-plugin case MUST run before the
 * registration case (vitest runs a file's tests in order).
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
import { z } from "zod";

import { POST as triggerPOST } from "../../app/api/kody/chat/trigger/route";
import { buildPluginToolsBearer } from "@dashboard/lib/chat/platform/plugin-tools-config";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function sessionPath(owner: string, repo: string, sessionId: string): string {
  return `/repos/${owner}/kody-state/contents/${repo}%2Fsessions%2F${sessionId}.jsonl`;
}

function mockDispatchTarget(sessionId: string): void {
  nock(GITHUB_API)
    .get("/repos/test-owner/test-repo/contents/kody.config.json")
    .reply(404);
  nock(GITHUB_API)
    .get(sessionPath("test-owner", "test-repo", sessionId))
    .query({ ref: STATE_BRANCH })
    .reply(404);
  nock(GITHUB_API)
    .get(`/repos/test-owner/kody-state/git/ref/heads%2F${STATE_BRANCH}`)
    .reply(200, { object: { sha: "state-sha" } });
  nock(GITHUB_API)
    .put(sessionPath("test-owner", "test-repo", sessionId))
    .reply(201, { content: { sha: "abc" } });
}

function makeRequest(taskId: string): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/trigger", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
    },
    body: JSON.stringify({
      taskId,
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      dashboardUrl: "https://dash.test",
    }),
  });
}

function expectDispatch(
  check: (dashboardUrl: string) => void,
): nock.Scope {
  return nock(GITHUB_API)
    .post(
      "/repos/test-owner/test-repo/actions/workflows/kody.yml/dispatches",
      (payload) => {
        expect(Object.keys(payload.inputs).sort()).toEqual([
          "dashboardUrl",
          "message",
          "sessionId",
        ]);
        check(payload.inputs.dashboardUrl);
        return true;
      },
    )
    .reply(204);
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "test-secret-for-chat-hmac";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

beforeEach(() => nock.cleanAll());
afterEach(() => nock.cleanAll());

describe("plugin-tools bridge fail-open (trigger route)", () => {
  it("no plugins registered → dashboardUrl carries ONLY the ingest token (pre-bridge bytes)", async () => {
    // Guard the precondition the whole proof rests on.
    expect(getChatServerToolRegistry().pluginIds()).toEqual([]);

    mockDispatchTarget("sess-failopen");
    const dispatch = expectDispatch((url) => {
      expect(url).toMatch(/^https:\/\/dash\.test\?token=[a-f0-9]+$/);
      expect(url).not.toContain("pluginTools");
    });

    const res = await triggerPOST(makeRequest("sess-failopen"));
    expect(res.status).toBe(200);
    expect(dispatch.isDone()).toBe(true);
  });

  it("a registered plugin → the same dispatch gains exactly one pluginTools bearer", async () => {
    getChatServerToolRegistry().register("failopen-fixture", () => ({
      failopen_tool: {
        description: "fixture",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      },
    }));

    mockDispatchTarget("sess-bridged");
    const expectedBearer = encodeURIComponent(
      buildPluginToolsBearer("test-owner", "test-repo"),
    );
    const dispatch = expectDispatch((url) => {
      expect(url).toMatch(
        new RegExp(
          `^https://dash\\.test\\?token=[a-f0-9]+&pluginTools=${expectedBearer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      );
    });

    const res = await triggerPOST(makeRequest("sess-bridged"));
    expect(res.status).toBe(200);
    expect(dispatch.isDone()).toBe(true);
  });
});
