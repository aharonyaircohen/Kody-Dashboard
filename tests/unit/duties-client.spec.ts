import { afterEach, describe, expect, it, vi } from "vitest";

import { dutiesApi } from "@dashboard/lib/api";
import { dutyQueryKeys } from "@dashboard/lib/hooks/useDuties";

describe("duties client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes duty list query keys by repo", () => {
    expect(dutyQueryKeys.list({ owner: "A-Guy-educ", repo: "A-Guy" })).toEqual([
      "kody-duties",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(dutyQueryKeys.list({ owner: "other", repo: "repo" })).not.toEqual(
      dutyQueryKeys.list({ owner: "A-Guy-educ", repo: "A-Guy" }),
    );
  });

  it("fetches the duties list without browser cache", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() =>
        JSON.stringify({
          token: "tok",
          owner: "A-Guy-educ",
          repo: "A-Guy",
        }),
      ),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("window", { localStorage: globalThis.localStorage });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ duties: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await dutiesApi.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/duties",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
