import { afterEach, describe, expect, it, vi } from "vitest";

import { kodyApi } from "@dashboard/lib/api";

describe("managed goals API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send browser actor login when creating a managed goal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          goal: {
            id: "verify-goal",
            path: ".kody/goals/instances/verify-goal/state.json",
            state: {
              version: 1,
              state: "active",
              type: "general",
              destination: {
                outcome: "Users can create goals from the dashboard.",
                evidence: ["goalVerified"],
              },
              duties: ["research"],
              route: [
                {
                  stage: "verify",
                  evidence: "goalVerified",
                  duty: "research",
                  executable: "research",
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
          duty: "research",
          executable: "research",
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
            path: ".kody/goals/instances/source-goal-20260620-120000/state.json",
            state: {
              version: 1,
              state: "active",
              type: "general",
              destination: {
                outcome: "Run this goal again.",
                evidence: ["goalVerified"],
              },
              duties: ["research"],
              route: [
                {
                  stage: "verify",
                  evidence: "goalVerified",
                  duty: "research",
                  executable: "research",
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
      outcome: "Run this goal again.",
      evidence: ["goalVerified"],
      route: [
        {
          stage: "verify",
          evidence: "goalVerified",
          duty: "research",
          executable: "research",
        },
      ],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.id).toBe("source-goal-20260620-120000");
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
              path: ".kody/goals/instances/verify-goal/state.json",
              state: {
                version: 1,
                state: "active",
                type: "general",
                destination: {
                  outcome: "Edited goal.",
                  evidence: ["goalVerified"],
                },
                duties: ["research"],
                route: [
                  {
                    stage: "verify",
                    evidence: "goalVerified",
                    duty: "research",
                    executable: "research",
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
    });
    await kodyApi.goals.removeManaged("verify-goal");

    const [, updateInit] = fetchMock.mock.calls[0]!;
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]!;
    const updateBody = JSON.parse(String(updateInit?.body));
    expect(updateBody.schedule).toBe("7d");
    expect(updateBody).not.toHaveProperty("actorLogin");
    expect(String(deleteUrl)).toBe("/api/kody/goals/managed/verify-goal");
    expect(deleteInit?.body).toBeUndefined();
  });
});
