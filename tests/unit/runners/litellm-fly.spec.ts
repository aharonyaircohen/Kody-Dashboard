/**
 * litellm-fly module tests. Exercises the read-only status probe for the
 * shared always-on LiteLLM Fly app against a mocked Fly Machines API.
 *
 * Fly is mocked via globalThis.fetch — no network. The stub routes by path:
 * `/apps/<name>` (app existence) and `/apps/<name>/machines` (machine list).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LITELLM_APP_NAME,
  litellmStatus,
} from "@dashboard/lib/runners/litellm-fly";

const TOKEN = "fly-test-token";

interface StubResponses {
  /** Response for GET /apps/<name>. null → 404 (app not deployed). */
  app?: unknown | null;
  /** Response for GET /apps/<name>/machines. */
  machines?: Array<{ id: string; state?: string }>;
}

function installFetchStub(responses: StubResponses): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(body !== undefined ? JSON.stringify(body) : null, {
          status,
          headers: { "content-type": "application/json" },
        });

      if (/\/apps\/[^/]+\/machines$/.test(url)) {
        return json(responses.machines ?? []);
      }
      if (/\/apps\/[^/]+$/.test(url)) {
        if (responses.app === null || responses.app === undefined) {
          return json({ error: "not found" }, 404);
        }
        return json(responses.app);
      }
      return json({ error: "unexpected path" }, 500);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("litellmStatus", () => {
  it("throws when flyToken is empty", async () => {
    await expect(litellmStatus({ flyToken: "  " })).rejects.toThrow(
      /flyToken required/,
    );
  });

  it("returns off when the app is not deployed (404)", async () => {
    installFetchStub({ app: null });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("off");
    expect(out.machineCount).toBe(0);
    expect(out.app).toBe(LITELLM_APP_NAME);
  });

  it("returns off when the app exists but has no machines", async () => {
    installFetchStub({ app: { name: LITELLM_APP_NAME }, machines: [] });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("off");
    expect(out.machineCount).toBe(0);
  });

  it("returns running when any machine is started", async () => {
    installFetchStub({
      app: { name: LITELLM_APP_NAME },
      machines: [
        { id: "m1", state: "stopped" },
        { id: "m2", state: "started" },
      ],
    });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("running");
    expect(out.machineCount).toBe(2);
  });

  it("returns suspended when machines exist but none running and one suspended", async () => {
    installFetchStub({
      app: { name: LITELLM_APP_NAME },
      machines: [{ id: "m1", state: "suspended" }],
    });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("suspended");
    expect(out.machineCount).toBe(1);
  });

  it("returns stopped when machines exist but none running or suspended", async () => {
    installFetchStub({
      app: { name: LITELLM_APP_NAME },
      machines: [{ id: "m1", state: "stopped" }],
    });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("stopped");
    expect(out.machineCount).toBe(1);
  });

  it("ignores destroyed machines in the count and state", async () => {
    installFetchStub({
      app: { name: LITELLM_APP_NAME },
      machines: [
        { id: "m1", state: "destroyed" },
        { id: "m2", state: "destroying" },
      ],
    });
    const out = await litellmStatus({ flyToken: TOKEN });
    expect(out.state).toBe("off");
    expect(out.machineCount).toBe(0);
  });

  it("honors appNameOverride", async () => {
    installFetchStub({ app: { name: "custom-litellm" } });
    const out = await litellmStatus({
      flyToken: TOKEN,
      appNameOverride: "custom-litellm",
    });
    expect(out.app).toBe("custom-litellm");
  });
});
