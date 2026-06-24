/**
 * Regression tests for the PATCH /api/kody/company/config route.
 *
 * The route must preserve `agent.reasoningEffort` when the request body
 * omits the field — saving an unrelated section (e.g. just `quality`)
 * must not clear the engine's thinking level. The bug this guards
 * against: a prior version coalesced the destructured `reasoningEffort`
 * to `?? null` before passing it to `writeConfigPatch`, which made every
 * PATCH — even ones that never touched reasoning — strip the field.
 *
 * `writeConfigPatch` itself distinguishes "absent" (`undefined`, don't
 * touch) from "explicitly cleared" (`null`, remove the field). The route
 * is responsible for passing the value through unchanged.
 *
 * @testFramework vitest
 * @domain engine-config-route
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({ __octokit: true })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", avatar_url: "u", githubId: 1 },
  })),
}));

const engineConfig = vi.hoisted(() => ({
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(async () => ({ sha: "new-sha" })),
  // Used by the route for the Zod enum — must be a real list of values
  // the route re-exports, so the test pins the shape.
  VALID_ASSOCIATIONS: [
    "OWNER",
    "MEMBER",
    "COLLABORATOR",
    "CONTRIBUTOR",
    "FIRST_TIMER",
    "FIRST_TIME_CONTRIBUTOR",
    "MANNEQUIN",
    "NONE",
  ] as const,
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: engineConfig.getEngineConfig,
  writeConfigPatch: engineConfig.writeConfigPatch,
  VALID_ASSOCIATIONS: engineConfig.VALID_ASSOCIATIONS,
}));

import { PATCH } from "../../app/api/kody/company/config/route";

function patchReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/company/config", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
      "content-type": "application/json",
    },
  });
}

const STORED_CONFIG = {
  agentActions: { default: "run" },
  github: { owner: "acme", repo: "widgets" },
  agent: {
    model: "minimax/MiniMax-M2.7-highspeed",
    perAgentAction: { research: "anthropic/claude-opus-4-7" },
    reasoningEffort: "medium",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The route reads back the merged config after the write so the client
  // reflects what landed. Hand it the same config we started with — the
  // assertions focus on the patch shape, not the round-trip.
  engineConfig.getEngineConfig.mockResolvedValue({
    config: structuredClone(STORED_CONFIG),
    sha: "stored-sha",
  });
});

describe("PATCH /api/kody/company/config — reasoningEffort handling", () => {
  it("a PATCH with only `quality` preserves the existing agent.reasoningEffort", async () => {
    const res = await PATCH(
      patchReq({
        quality: { typecheck: "tsc --noEmit" },
        actorLogin: "alice",
      }),
    );
    expect(res.status).toBe(200);

    // The route must NOT have passed reasoningEffort: null in the patch —
    // that's the bug. Either the key is absent (preferred) or its value is
    // `undefined`; both let writeConfigPatch skip the field.
    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    const patch = calls[0][3];
    expect(patch.reasoningEffort).toBeUndefined();
    // The rest of the editable slice was forwarded as-is.
    expect(patch.quality).toEqual({ typecheck: "tsc --noEmit" });
  });

  it("a PATCH with reasoningEffort: null is forwarded as null (clear semantics)", async () => {
    const res = await PATCH(
      patchReq({
        reasoningEffort: null,
        actorLogin: "alice",
      }),
    );
    expect(res.status).toBe(200);

    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    const patch = calls[0][3];
    // Explicit null must be passed through — the route must not collapse
    // null and undefined into the same "clear" signal; they are distinct
    // in the patch contract.
    expect(patch.reasoningEffort).toBeNull();
  });

  it("a PATCH with a valid reasoning effort value is forwarded verbatim", async () => {
    const res = await PATCH(
      patchReq({
        reasoningEffort: "low",
        actorLogin: "alice",
      }),
    );
    expect(res.status).toBe(200);

    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    const patch = calls[0][3];
    expect(patch.reasoningEffort).toBe("low");
  });

  it("a PATCH with reasoningEffort: 'off' is forwarded verbatim (not coalesced to null)", async () => {
    // 'off' and null both mean "no thinking" from the engine's perspective.
    // The route must not collapse them — the underlying function decides
    // whether the canonical unset is "remove the field" or "store 'off'".
    const res = await PATCH(
      patchReq({
        reasoningEffort: "off",
        actorLogin: "alice",
      }),
    );
    expect(res.status).toBe(200);

    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    const patch = calls[0][3];
    expect(patch.reasoningEffort).toBe("off");
  });

  it("a PATCH with reasoningEffort: 'unknown' is rejected with 400 by the Zod schema", async () => {
    const res = await PATCH(
      patchReq({
        reasoningEffort: "ultralow",
        actorLogin: "alice",
      }),
    );
    expect(res.status).toBe(400);
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });

  it("a PATCH with state writes the external Kody state repo config", async () => {
    const state = {
      repo: "https://github.com/acme/kody-state",
      path: "widgets",
    };
    engineConfig.getEngineConfig.mockResolvedValueOnce({
      config: { ...structuredClone(STORED_CONFIG), state },
      sha: "new-sha",
    });

    const res = await PATCH(
      patchReq({
        state,
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ state });

    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0][3].state).toEqual(state);
  });

  it("a PATCH with invalid state repo is rejected with 400 by Zod schema", async () => {
    const res = await PATCH(
      patchReq({
        state: { repo: "kody-state", path: "widgets" },
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(400);
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });

  it("a PATCH with unsafe state path is rejected with 400 by Zod schema", async () => {
    const res = await PATCH(
      patchReq({
        state: {
          repo: "https://github.com/acme/kody-state",
          path: "../widgets",
        },
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(400);
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });
});
