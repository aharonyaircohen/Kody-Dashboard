/**
 * Unit tests for the Fly preview machine API client
 * (src/dashboard/lib/previews/fly-previews.ts).
 *
 * Focus: `createMachine`'s `checks` block gating. A periodic HTTP check
 * (GET / every 15s) keeps a Fly machine "active" forever, which prevents
 * `autostop: "suspend"` from firing on idle. Static previews serve stock
 * nginx with no real health-check requirement, so the helper must NOT
 * emit the `checks` block by default — only when the caller opts in
 * with `healthCheck: true`. Mirrors the builder's
 * `builder/src/fly-api.ts` gating on `fly.previews.healthCheck`.
 *
 * The Fly REST endpoint is mocked at the `globalThis.fetch` boundary —
 * the same seam `issue-attachments.spec.ts` uses for its HTTP tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMachine,
  type FlyPreviewConfig,
} from "@dashboard/lib/previews/fly-previews";

const CFG: FlyPreviewConfig = {
  token: "test-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

interface CapturedRequest {
  url: string;
  parsedBody: {
    config: {
      checks?: unknown;
      services?: Array<{ autostop?: unknown }>;
    } & Record<string, unknown>;
  } & Record<string, unknown>;
}

function mockCreateResponse(captured: CapturedRequest[]) {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/machines") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        captured.push({ url, parsedBody: body });
        return new Response(
          JSON.stringify({ id: "m-1", state: "starting", region: "fra" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    },
  ) as unknown as typeof fetch;
}

describe("createMachine checks block", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits the checks block by default (lets autostop:suspend fire on idle)", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "nginx:alpine",
        internalPort: 80,
      },
      CFG,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].parsedBody.config.checks).toBeUndefined();
  });

  it("omits the checks block when healthCheck is explicitly false", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "nginx:alpine",
        internalPort: 80,
        healthCheck: false,
      },
      CFG,
    );

    expect(captured[0].parsedBody.config.checks).toBeUndefined();
  });

  it("emits the checks block when healthCheck: true", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "nginx:alpine",
        internalPort: 8080,
        healthCheck: true,
      },
      CFG,
    );

    expect(captured[0].parsedBody.config.checks).toEqual({
      httpget: {
        type: "http",
        port: 8080,
        method: "GET",
        path: "/",
        interval: "15s",
        timeout: "10s",
        grace_period: "30s",
      },
    });
  });

  it("uses suspend for previews at or below Fly's 2 GB suspend limit", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "nginx:alpine",
        internalPort: 8080,
        memoryMb: 2048,
      },
      CFG,
    );

    expect(captured[0].parsedBody.config.services?.[0]?.autostop).toBe(
      "suspend",
    );
  });

  it("stops oversized previews instead of asking Fly to suspend them", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "nginx:alpine",
        internalPort: 8080,
        memoryMb: 4096,
      },
      CFG,
    );

    expect(captured[0].parsedBody.config.services?.[0]?.autostop).toBe(true);
  });
});
