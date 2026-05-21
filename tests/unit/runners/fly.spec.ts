/**
 * spawnRunner tests. Exercises the one-shot Fly Machine create call against a
 * mocked Fly Machines API (globalThis.fetch — no network).
 *
 * Focus: the request is BOUNDED. A hung Fly API must reject quickly (via an
 * abort signal) rather than hold the Vibe/start request open until the
 * serverless runtime kills it — that's the warmup-fragility this guards.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { spawnRunner } from "@dashboard/lib/runners/fly";

const BASE_INPUT = {
  repo: "acme/widgets",
  githubToken: "gh-pat",
  sessionId: "sess-1",
  flyToken: "fly-test-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spawnRunner", () => {
  it("returns the machine id + region on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "m-123", region: "fra" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const out = await spawnRunner(BASE_INPUT);
    expect(out).toMatchObject({ machineId: "m-123", region: "fra" });
  });

  it("passes an abort signal so a hung Fly API can't block forever", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "m-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await spawnRunner(BASE_INPUT);

    const init = fetchMock.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("wraps a timeout/network rejection in a clean error (no raw DOMException)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // What AbortSignal.timeout produces when it fires.
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );

    await expect(spawnRunner(BASE_INPUT)).rejects.toThrow(
      /Fly Machines API request failed/,
    );
  });

  it("throws with the status code when the Fly API returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "capacity" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(spawnRunner(BASE_INPUT)).rejects.toThrow(/503/);
  });

  it("rejects when no Fly token is provided", async () => {
    await expect(
      spawnRunner({ ...BASE_INPUT, flyToken: "   " }),
    ).rejects.toThrow(/not configured/);
  });
});
