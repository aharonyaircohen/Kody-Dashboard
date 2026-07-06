import { describe, expect, it, vi } from "vitest";

import {
  buildKodyWorkflowDispatchInputs,
  parseWorkflowDispatchInputNames,
} from "@dashboard/lib/kody-workflow-dispatch";

const executableWorkflow = `
name: kody
on:
  workflow_dispatch:
    inputs:
      issue_number:
        type: string
        default: ""
      message:
        type: string
        default: ""
      implementation:
        type: string
        default: ""
      storeRepoUrl:
        type: string
        default: ""
      storeRef:
        type: string
        default: ""
`;

function octokitWithWorkflow(workflow: string) {
  return {
    rest: {
      repos: {
        getContent: vi.fn(async () => ({
          data: {
            type: "file",
            encoding: "base64",
            content: Buffer.from(workflow, "utf8").toString("base64"),
          },
        })),
      },
    },
  };
}

describe("kody workflow dispatch input mapping", () => {
  it("parses workflow_dispatch input names from kody.yml", () => {
    expect(parseWorkflowDispatchInputNames(executableWorkflow)).toEqual(
      new Set([
        "issue_number",
        "message",
        "implementation",
        "storeRepoUrl",
        "storeRef",
      ]),
    );
  });

  it("uses implementation when the target workflow declares it", async () => {
    const octokit = octokitWithWorkflow(executableWorkflow);

    await expect(
      buildKodyWorkflowDispatchInputs(octokit, {
        owner: "test-owner",
        repo: "test-repo",
        ref: "main",
        action: "goal-manager",
        message: "web-release",
        storeRepoUrl: "https://github.com/acme/kody-store",
        storeRef: "main",
      }),
    ).resolves.toEqual({
      implementation: "goal-manager",
      message: "web-release",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "main",
    });
  });

  it("falls back to implementation when workflow inputs cannot be read", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => {
            throw new Error("not available");
          }),
        },
      },
    };

    await expect(
      buildKodyWorkflowDispatchInputs(octokit, {
        owner: "test-owner",
        repo: "test-repo",
        ref: "main",
        action: "repo-graph",
      }),
    ).resolves.toEqual({ implementation: "repo-graph" });
  });
});
