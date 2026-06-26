/** @fileoverview Unit tests for managed goal GitHub file helpers. */
import { describe, expect, it, vi } from "vitest";

import { readManagedGoalFile } from "../../src/dashboard/lib/managed-goals-files";

describe("readManagedGoalFile", () => {
  it("normalizes engine-written null capabilities", async () => {
    const repos = {
      get: vi.fn(async () => ({
        data: {
          default_branch: "main",
        },
      })),
      getContent: vi.fn(async ({ path }: { path: string }) => {
        if (path === "kody.config.json") {
          return {
            data: {
              type: "file",
              sha: "config-sha",
              content: Buffer.from("{}", "utf8").toString("base64"),
              encoding: "base64",
            },
          };
        }

        return {
          data: {
            type: "file",
            sha: "goal-sha",
            content: Buffer.from(
              JSON.stringify({
                version: 1,
                state: "active",
                type: "improve",
                destination: {
                  outcome: "Goal creation works.",
                  evidence: ["planReady"],
                },
                capabilities: null,
                route: [
                  {
                    stage: "plan",
                    evidence: "planReady",
                    capability: "plan",
                  },
                ],
                facts: {},
                blockers: [],
              }),
              "utf8",
            ).toString("base64"),
            encoding: "base64",
          },
        };
      }),
    };
    const octokit = {
      repos,
      rest: { repos },
    };

    const file = await readManagedGoalFile(
      "goal-creation-works",
      octokit as never,
      "test-owner",
      "test-repo",
    );

    expect(file?.sha).toBe("goal-sha");
    expect(file?.state.capabilities).toEqual(["plan"]);
  });
});
