import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDashboardConfig,
  saveDashboardConfig,
} from "@dashboard/lib/dashboard-config/client";

const AUTH = {
  token: "tok",
  owner: "owner",
  repo: "repo",
};

function stubAuth(): void {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => JSON.stringify(AUTH)),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("window", { localStorage: globalThis.localStorage });
}

describe("dashboard config client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains network failures while saving preview environments", async () => {
    stubAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(saveDashboardConfig({ namedPreviews: [] })).rejects.toThrow(
      "Couldn't reach the dashboard API to save preview environments. Failed to fetch",
    );
  });

  it("uses server JSON messages when a save is rejected", async () => {
    stubAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Bad preview URL" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(saveDashboardConfig({ namedPreviews: [] })).rejects.toThrow(
      "Bad preview URL",
    );
  });

  it("hides HTML error bodies behind a short status message", async () => {
    stubAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><h1>Not found</h1>", {
            status: 404,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    await expect(fetchDashboardConfig()).rejects.toThrow(
      "Failed to load config (404)",
    );
  });
});
