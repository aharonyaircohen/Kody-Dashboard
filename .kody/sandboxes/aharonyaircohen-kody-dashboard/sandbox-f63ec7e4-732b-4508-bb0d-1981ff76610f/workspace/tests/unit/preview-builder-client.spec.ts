import { afterEach, describe, expect, it, vi } from "vitest";

import { spawnPreviewBuilder } from "@dashboard/lib/previews/builder-client";

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/preview-token", () => ({
  derivePreviewKey: () => Buffer.from("preview-key"),
}));

const NOW = new Date("2026-06-08T12:00:00Z");

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function baseInput() {
  return {
    repo: "acme/widgets",
    pr: 7,
    ref: "abc1234",
    appName: "kp-acme-widgets-pr-7",
    imageTag: "abc1234",
    flyToken: "fly-token",
    flyOrgSlug: "personal",
    flyRegion: "fra",
  };
}

describe("spawnPreviewBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("destroys an existing builder for the same preview before spawning a new one", async () => {
    vi.setSystemTime(NOW);
    const calls: Call[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init = {}) => {
      const url = input.toString();
      const method = init.method ?? "GET";
      calls.push({
        method,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (method === "GET") {
        return Response.json([
          {
            id: "old-same",
            state: "started",
            created_at: "2026-06-08T11:55:00Z",
            config: { env: { APP_NAME: "kp-acme-widgets-pr-7" } },
          },
          {
            id: "other-pr",
            state: "started",
            created_at: "2026-06-08T11:55:00Z",
            config: { env: { APP_NAME: "kp-acme-widgets-pr-8" } },
          },
        ]);
      }
      if (method === "DELETE") return Response.json({ ok: true });
      return Response.json({ id: "new-builder" });
    }) as unknown as typeof fetch;

    const out = await spawnPreviewBuilder(baseInput());

    expect(out.machineId).toBe("new-builder");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.machines.dev/v1/apps/kody-preview-builder/machines",
      "DELETE https://api.machines.dev/v1/apps/kody-preview-builder/machines/old-same?force=true",
      "POST https://api.machines.dev/v1/apps/kody-preview-builder/machines",
    ]);
    expect(JSON.stringify(calls)).not.toContain("other-pr?force=true");
  });

  it("also removes very old builders even when they belong to another preview", async () => {
    vi.setSystemTime(NOW);
    const deleted: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init = {}) => {
      const url = input.toString();
      const method = init.method ?? "GET";
      if (method === "GET") {
        return Response.json([
          {
            id: "stale-other",
            state: "started",
            created_at: "2026-06-08T08:30:00Z",
            config: { env: { APP_NAME: "kp-acme-widgets-pr-99" } },
          },
          {
            id: "fresh-other",
            state: "started",
            created_at: "2026-06-08T11:30:00Z",
            config: { env: { APP_NAME: "kp-acme-widgets-pr-8" } },
          },
        ]);
      }
      if (method === "DELETE") {
        deleted.push(url);
        return Response.json({ ok: true });
      }
      return Response.json({ id: "new-builder" });
    }) as unknown as typeof fetch;

    await spawnPreviewBuilder(baseInput());

    expect(deleted).toEqual([
      "https://api.machines.dev/v1/apps/kody-preview-builder/machines/stale-other?force=true",
    ]);
  });
});
