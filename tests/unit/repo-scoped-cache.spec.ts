import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contextApi,
  memoryApi,
  reportsApi,
  staffApi,
} from "@dashboard/lib/api";
import { commandsQueryKeys } from "@dashboard/lib/components/CommandsManager";
import { agentActionQueryKeys } from "@dashboard/lib/components/AgentActionsManager";
import { instructionsQueryKeys } from "@dashboard/lib/components/InstructionsManager";
import { modelsQueryKeys } from "@dashboard/lib/components/ModelsManager";
import { secretsQueryKeys } from "@dashboard/lib/components/SecretsManager";
import { variablesQueryKeys } from "@dashboard/lib/components/VariablesManager";
import { contextQueryKeys } from "@dashboard/lib/hooks/useContextEntries";
import { memoryQueryKeys } from "@dashboard/lib/hooks/useMemory";
import { reportQueryKeys } from "@dashboard/lib/hooks/useReports";
import { agentQueryKeys } from "@dashboard/lib/hooks/useAgents";

function stubAuth() {
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
}

describe("repo-scoped dashboard caches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes repo-owned query keys by owner and repo", () => {
    const scope = { owner: "A-Guy-educ", repo: "A-Guy" };
    const other = { owner: "other", repo: "repo" };

    expect(agentQueryKeys.list(scope)).toEqual([
      "kody-agent",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(contextQueryKeys.list(scope)).toEqual([
      "kody-context",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(memoryQueryKeys.list(scope)).toEqual([
      "kody-memory",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(reportQueryKeys.list(scope)).toEqual([
      "kody-reports",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(agentActionQueryKeys.list(scope)).toEqual([
      "kody-agentActions",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(commandsQueryKeys.list(scope)).toEqual([
      "kody-commands",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(variablesQueryKeys.list(scope)).toEqual([
      "kody-variables",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(secretsQueryKeys.list(scope)).toEqual([
      "kody-secrets",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(instructionsQueryKeys.file(scope)).toEqual([
      "kody-instructions",
      "A-Guy-educ",
      "A-Guy",
    ]);
    expect(modelsQueryKeys.list(scope)).toEqual([
      "kody-chat-models",
      "A-Guy-educ",
      "A-Guy",
    ]);

    expect(agentQueryKeys.list(scope)).not.toEqual(agentQueryKeys.list(other));
    expect(contextQueryKeys.list(scope)).not.toEqual(
      contextQueryKeys.list(other),
    );
    expect(memoryQueryKeys.list(scope)).not.toEqual(
      memoryQueryKeys.list(other),
    );
    expect(reportQueryKeys.list(scope)).not.toEqual(
      reportQueryKeys.list(other),
    );
    expect(agentActionQueryKeys.list(scope)).not.toEqual(
      agentActionQueryKeys.list(other),
    );
    expect(commandsQueryKeys.list(scope)).not.toEqual(
      commandsQueryKeys.list(other),
    );
    expect(variablesQueryKeys.list(scope)).not.toEqual(
      variablesQueryKeys.list(other),
    );
    expect(secretsQueryKeys.list(scope)).not.toEqual(
      secretsQueryKeys.list(other),
    );
    expect(instructionsQueryKeys.file(scope)).not.toEqual(
      instructionsQueryKeys.file(other),
    );
    expect(modelsQueryKeys.list(scope)).not.toEqual(
      modelsQueryKeys.list(other),
    );
  });

  it("fetches repo-owned lists without browser cache", async () => {
    stubAuth();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/agents")
        ? { agent: [] }
        : url.includes("/context")
          ? { entries: [] }
          : url.includes("/memory")
            ? { memories: [] }
            : { reports: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await staffApi.list();
    await contextApi.list();
    await memoryApi.list();
    await reportsApi.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/agents",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/context",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/memory",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/reports",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
