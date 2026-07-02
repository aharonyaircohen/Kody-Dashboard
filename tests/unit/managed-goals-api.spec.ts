import { afterEach, describe, expect, it, vi } from "vitest";

import { kodyApi } from "@dashboard/lib/api";

describe("managed goals API client", () => {
  function stubStoredAuth(value: unknown) {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === "kody_auth" ? JSON.stringify(value) : null,
      ),
    };
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
    return storage;
  }

  it("surfaces managed goal create failure messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "failed_to_create_managed_goal",
          message: "Invalid request: Kody state repo could not be updated.",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      kodyApi.goals.createManaged({
        type: "improve",
        schedule: "manual",
        outcome: "Users can create goals from dashboard.",
        evidence: ["goalVerified"],
        route: [
          {
            stage: "verify",
            evidence: "goalVerified",
            capability: "research",
          },
        ],
      }),
    ).rejects.toThrow("Invalid request: Kody state repo could not be updated.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends Store identity when listing managed goals", async () => {
    stubStoredAuth({
      token: "ghp_test-token",
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
      user: { login: "aguyaharonyair" },
      storeRepoUrl: "https://github.com/aharonyaircohen/kody-company-store",
      storeRef: "main",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ goals: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kodyApi.goals.listManaged();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "A-Guy-educ",
      "x-kody-repo": "A-Guy-Web",
      "x-kody-user-login": "aguyaharonyair",
      "x-kody-store-repo-url":
        "https://github.com/aharonyaircohen/kody-company-store",
      "x-kody-store-ref": "main",
    });
  });

  it("defaults Store identity when the browser auth predates Store settings", async () => {
    stubStoredAuth({
      token: "ghp_test-token",
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ goals: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kodyApi.goals.listManaged();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "x-kody-store-repo-url":
        "https://github.com/aharonyaircohen/kody-company-store",
      "x-kody-store-ref": "main",
    });
  });

  it("does not send browser actor login when creating a managed goal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          goal: {
            id: "verify-goal",
            path: "todos/verify-goal.json",
            state: {
              version: 1,
              state: "active",
              type: "general",
              destination: {
                outcome: "Users can create goals from the dashboard.",
                evidence: ["goalVerified"],
              },
              capabilities: ["research"],
              route: [
                {
                  stage: "verify",
                  evidence: "goalVerified",
                  capability: "research",
                },
              ],
              facts: {},
              blockers: [],
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kodyApi.goals.createManaged({
      type: "general",
      schedule: "1d",
      outcome: "Users can create goals from the dashboard.",
      evidence: ["goalVerified"],
      route: [
        {
          stage: "verify",
          evidence: "goalVerified",
          capability: "research",
        },
      ],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.schedule).toBe("1d");
    expect(body).not.toHaveProperty("actorLogin");
  });

  it("can create a scheduled managed goal instance with an explicit id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          goal: {
            id: "source-goal-20260620-120000",
            path: "todos/source-goal-20260620-120000.json",
            state: {
              version: 1,
              state: "active",
              type: "general",
              destination: {
                outcome: "Run this goal again.",
                evidence: ["goalVerified"],
              },
              capabilities: ["research"],
              route: [
                {
                  stage: "verify",
                  evidence: "goalVerified",
                  capability: "research",
                },
              ],
              facts: {},
              blockers: [],
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kodyApi.goals.createManaged({
      id: "source-goal-20260620-120000",
      type: "general",
      preferredRunTime: { time: "08:15", timezone: "UTC" },
      outcome: "Run this goal again.",
      evidence: ["goalVerified"],
      route: [
        {
          stage: "verify",
          evidence: "goalVerified",
          capability: "research",
        },
      ],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.id).toBe("source-goal-20260620-120000");
    expect(body.preferredRunTime).toEqual({
      time: "08:15",
      timezone: "UTC",
    });
    expect(body).not.toHaveProperty("actorLogin");
  });

  it("updates and deletes managed goals without browser actor login", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            goal: {
              id: "verify-goal",
              path: "todos/verify-goal.json",
              state: {
                version: 1,
                state: "active",
                type: "general",
                destination: {
                  outcome: "Edited goal.",
                  evidence: ["goalVerified"],
                },
                capabilities: ["research"],
                route: [
                  {
                    stage: "verify",
                    evidence: "goalVerified",
                    capability: "research",
                  },
                ],
                facts: {},
                blockers: [],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await kodyApi.goals.updateManaged("verify-goal", {
      outcome: "Edited goal.",
      schedule: "7d",
      preferredRunTime: { time: "09:00", timezone: "UTC" },
    });
    await kodyApi.goals.removeManaged("verify-goal");

    const [, updateInit] = fetchMock.mock.calls[0]!;
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]!;
    const updateBody = JSON.parse(String(updateInit?.body));
    expect(updateBody.schedule).toBe("7d");
    expect(updateBody.preferredRunTime).toEqual({
      time: "09:00",
      timezone: "UTC",
    });
    expect(updateBody).not.toHaveProperty("actorLogin");
    expect(String(deleteUrl)).toBe("/api/kody/goals/managed/verify-goal");
    expect(deleteInit?.body).toBeUndefined();
  });
});
