import { afterEach, describe, expect, it, vi } from "vitest";

import { agentResponsibilitiesApi } from "@dashboard/lib/api";
import { agentResponsibilityQueryKeys } from "@dashboard/lib/hooks/useAgentResponsibilities";

describe("agentResponsibilities client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes agentResponsibility list query keys by repo", () => {
    expect(agentResponsibilityQueryKeys.list({ owner: "A-Guy-educ", repo: "A-Guy" })).toEqual([
      "kody-agentResponsibilities",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(agentResponsibilityQueryKeys.list({ owner: "other", repo: "repo" })).not.toEqual(
      agentResponsibilityQueryKeys.list({ owner: "A-Guy-educ", repo: "A-Guy" }),
    );
  });

  it("fetches the agentResponsibilities list without browser cache", async () => {
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
        new Response(JSON.stringify({ agentResponsibilities: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await agentResponsibilitiesApi.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/agent-responsibilities",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
