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
  alignPreviewMachineSleep,
  alignPreviewMachineSleepConfig,
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
      guest?: { memory_mb?: number };
      services?: Array<{
        autostop?: unknown;
        autostart?: unknown;
        min_machines_running?: unknown;
      }>;
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

describe("alignPreviewMachineSleepConfig", () => {
  it("adds sleep/wake settings and removes health checks", () => {
    const result = alignPreviewMachineSleepConfig(
      {
        image: "nginx:alpine",
        guest: { memory_mb: 2048 },
        checks: { old: true },
        services: [
          {
            internal_port: 8080,
            autostop: false,
            autostart: false,
            min_machines_running: 1,
          },
        ],
      },
      { idleSuspend: true, healthCheck: false },
    );

    expect(result).toMatchObject({ changed: true, skipped: false });
    expect(result.config?.checks).toBeUndefined();
    expect(result.config?.services?.[0]).toMatchObject({
      internal_port: 8080,
      autostop: "suspend",
      autostart: true,
      min_machines_running: 0,
    });
  });

  it("uses cold stop for machines over Fly's suspend limit", () => {
    const result = alignPreviewMachineSleepConfig(
      {
        guest: { memory_mb: 4096 },
        services: [{ autostop: false, autostart: false }],
      },
      { idleSuspend: true, healthCheck: false },
    );

    expect(result.config?.services?.[0]).toMatchObject({
      autostop: true,
      autostart: true,
    });
  });

  it("keeps checks only when the repo explicitly opts into health checks", () => {
    const result = alignPreviewMachineSleepConfig(
      {
        checks: { httpget: { path: "/" } },
        services: [{ autostop: "suspend", autostart: true }],
      },
      { idleSuspend: true, healthCheck: true, memoryMb: 2048 },
    );

    expect(result).toMatchObject({ changed: true, skipped: false });
    expect(result.config?.checks).toEqual({ httpget: { path: "/" } });
    expect(result.config?.services?.[0]?.min_machines_running).toBe(0);
  });

  it("skips machines without services because Fly cannot autowake them", () => {
    const result = alignPreviewMachineSleepConfig(
      { image: "busybox" },
      { idleSuspend: true, healthCheck: false },
    );

    expect(result).toEqual({
      changed: false,
      skipped: true,
      reason: "missing_services",
    });
  });
});

describe("alignPreviewMachineSleep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a fresh machine config before posting the repaired config", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        requests.push({
          url,
          method,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });

        if (method === "GET") {
          return new Response(
            JSON.stringify({
              id: "m-1",
              state: "started",
              region: "fra",
              config: {
                image: "nginx:alpine",
                guest: { memory_mb: 2048 },
                checks: { old: true },
                services: [{ internal_port: 8080, autostart: false }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;

    await expect(
      alignPreviewMachineSleep("kp-test-app", "m-1", CFG, {
        idleSuspend: true,
        healthCheck: false,
      }),
    ).resolves.toEqual({ changed: true, skipped: false });

    expect(requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(requests[1].body).toEqual({
      config: {
        image: "nginx:alpine",
        guest: { memory_mb: 2048 },
        services: [
          {
            internal_port: 8080,
            autostop: "suspend",
            autostart: true,
            min_machines_running: 0,
          },
        ],
      },
    });
  });

  it("does not post when the machine already matches", async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        return new Response(
          JSON.stringify({
            id: "m-1",
            state: "suspended",
            region: "fra",
            config: {
              guest: { memory_mb: 2048 },
              services: [
                {
                  autostop: "suspend",
                  autostart: true,
                  min_machines_running: 0,
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;

    await expect(
      alignPreviewMachineSleep("kp-test-app", "m-1", CFG, {
        idleSuspend: true,
        healthCheck: false,
      }),
    ).resolves.toEqual({ changed: false, skipped: false });

    expect(methods).toEqual(["GET"]);
  });
});
