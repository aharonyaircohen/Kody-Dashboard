/**
 * @fileoverview Unit tests for `writeConfigPatch` reasoningEffort handling.
 * @testFramework vitest
 * @domain engine-config
 *
 * Three regression scenarios for the reasoningEffort patch flow:
 *   1. A patch that doesn't touch reasoning must preserve any pre-existing
 *      `agent.reasoningEffort` (and every other agent field).
 *   2. A patch with `reasoningEffort: null` must clear only that field,
 *      keeping `agent.model` and `agent.perExecutable` intact.
 *   3. A patch with a valid reasoning effort ("low"/"medium"/"high"/"off")
 *      must write the value to `agent.reasoningEffort`.
 *
 * The first one is the load-bearing one — the original regression was that
 * the route coalesced an omitted `reasoningEffort` to `null` before calling
 * this function, turning every quality-only PATCH into an effective clear.
 * The function itself was already correct; these tests pin its contract.
 */

import { describe, expect, it, vi } from "vitest";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";

function encodeConfig(config: unknown): string {
  return Buffer.from(JSON.stringify(config), "utf-8").toString("base64");
}

function contentResponse(config: unknown, sha: string) {
  return {
    data: {
      content: encodeConfig(config),
      sha,
    },
  };
}

function decodeConfigWrite(write: Record<string, unknown>) {
  return JSON.parse(
    Buffer.from(write.content as string, "base64").toString("utf-8"),
  );
}

function octokitWithConfig(config: unknown) {
  const writes: Array<Record<string, unknown>> = [];
  const octokit = {
    rest: {
      repos: {
        getContent: vi.fn().mockResolvedValue(contentResponse(config, "sha-1")),
        createOrUpdateFileContents: vi
          .fn()
          .mockImplementation(async (p: Record<string, unknown>) => {
            writes.push(p);
            return { data: { commit: { sha: "commit-1" } } };
          }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const lastWritten = () => decodeConfigWrite(writes.at(-1)!);
  return { octokit, lastWritten, writes };
}

describe("getEngineConfig", () => {
  it("preserves active Store goal references", async () => {
    const { octokit } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      company: {
        activeAgents: ["cto"],
        activeGoals: ["web-release", { template: "weekly-check", every: "1w" }],
      },
    });

    const { config } = await getEngineConfig(
      octokit,
      "o",
      "company-active-goals",
      { force: true },
    );

    expect(config.company?.activeGoals).toEqual([
      "web-release",
      { template: "weekly-check", every: "1w" },
    ]);
  });
});

describe("writeConfigPatch — reasoningEffort", () => {
  it("patch with only `quality` preserves the existing agent.reasoningEffort", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      agent: {
        model: "minimax/MiniMax-M2.7-highspeed",
        perExecutable: { research: "anthropic/claude-opus-4-7" },
        reasoningEffort: "medium",
      },
    });

    // Patch touches only quality — the `reasoningEffort` key is absent
    // (this is what the route must do after the fix).
    await writeConfigPatch(octokit, "o", "r", {
      quality: { typecheck: "tsc --noEmit" },
    });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBe("medium");
    expect(written.agent?.model).toBe("minimax/MiniMax-M2.7-highspeed");
    expect(written.agent?.perExecutable).toEqual({
      research: "anthropic/claude-opus-4-7",
    });
    expect(written.quality).toEqual({ typecheck: "tsc --noEmit" });
  });

  it("patch with reasoningEffort: null clears only that field, keeping model and perExecutable", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      agent: {
        model: "minimax/MiniMax-M2.7-highspeed",
        perExecutable: { research: "anthropic/claude-opus-4-7" },
        reasoningEffort: "high",
      },
    });

    await writeConfigPatch(octokit, "o", "r", { reasoningEffort: null });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBeUndefined();
    expect(written.agent?.model).toBe("minimax/MiniMax-M2.7-highspeed");
    expect(written.agent?.perExecutable).toEqual({
      research: "anthropic/claude-opus-4-7",
    });
  });

  it("patch with a valid reasoning effort writes agent.reasoningEffort", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      agent: { model: "anthropic/claude-sonnet-4-6" },
    });

    await writeConfigPatch(octokit, "o", "r", { reasoningEffort: "low" });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBe("low");
    expect(written.agent?.model).toBe("anthropic/claude-sonnet-4-6");
  });
});

describe("writeConfigPatch — store activation", () => {
  it("writes active store references under company without copying assets", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      company: { ownerNote: "keep" },
    });

    await writeConfigPatch(octokit, "o", "r", {
      activeAgents: ["cto", "cto", "qa"],
      activeCapabilities: ["run", "run", "fix-ci"],
      activeGoals: [
        "web-release",
        {
          template: "weekly-check",
          every: "1w",
          idPrefix: "weekly",
          facts: { issue: 123 },
        },
      ],
    });

    const written = lastWritten();
    expect(written.company).toEqual({
      ownerNote: "keep",
      activeAgents: ["cto", "qa"],
      activeCapabilities: ["run", "fix-ci"],
      activeGoals: [
        "web-release",
        {
          template: "weekly-check",
          every: "1w",
          idPrefix: "weekly",
          facts: { issue: 123 },
        },
      ],
    });
    expect(written[".kody"]).toBeUndefined();
  });

  it("clears active store references without clearing other company keys", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      company: {
        ownerNote: "keep",
        activeAgents: ["cto"],
        activeCapabilities: ["run"],
        activeGoals: ["web-release"],
      },
    });

    await writeConfigPatch(octokit, "o", "r", {
      activeAgents: null,
      activeCapabilities: null,
      activeGoals: null,
    });

    const written = lastWritten();
    expect(written.company).toEqual({ ownerNote: "keep" });
  });

  it("retries active store reference writes after a stale GitHub contents sha", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const staleShaError = Object.assign(
      new Error(
        "kody.config.json does not match sha-stale - https://docs.github.com/rest/repos/contents#create-or-update-file-contents",
      ),
      { status: 409 },
    );
    const octokit = {
      rest: {
        repos: {
          getContent: vi
            .fn()
            .mockResolvedValueOnce(
              contentResponse(
                {
                  executables: { default: "run" },
                  github: { owner: "o", repo: "r" },
                  company: {
                    ownerNote: "stale",
                    activeCapabilities: ["run", "fix-ci"],
                  },
                },
                "sha-stale",
              ),
            )
            .mockResolvedValueOnce(
              contentResponse(
                {
                  executables: { default: "run" },
                  github: { owner: "o", repo: "r" },
                  aliases: { deploy: "run" },
                  company: {
                    ownerNote: "fresh",
                    activeAgents: ["cto"],
                    activeCapabilities: ["run", "fix-ci"],
                  },
                },
                "sha-fresh",
              ),
            ),
          createOrUpdateFileContents: vi
            .fn()
            .mockImplementationOnce(async (p: Record<string, unknown>) => {
              writes.push(p);
              throw staleShaError;
            })
            .mockImplementationOnce(async (p: Record<string, unknown>) => {
              writes.push(p);
              return { data: { commit: { sha: "commit-2" } } };
            }),
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      writeConfigPatch(octokit, "o", "r", {
        activeCapabilities: ["run"],
      }),
    ).resolves.toEqual({ sha: "commit-2" });

    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(
      2,
    );
    expect(writes[0]?.sha).toBe("sha-stale");
    expect(writes[1]?.sha).toBe("sha-fresh");
    const written = decodeConfigWrite(writes[1]!);
    expect(written.aliases).toEqual({ deploy: "run" });
    expect(written.company).toEqual({
      ownerNote: "fresh",
      activeAgents: ["cto"],
      activeCapabilities: ["run"],
    });
  });
});

describe("writeConfigPatch — state repo", () => {
  it("writes external state repo config", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
    });

    await writeConfigPatch(octokit, "o", "r", {
      state: { repo: "https://github.com/o/kody-state", path: "r" },
    });

    expect(lastWritten().state).toEqual({
      repo: "https://github.com/o/kody-state",
      path: "r",
    });
  });

  it("clears state repo config", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      state: { repo: "https://github.com/o/kody-state", path: "r" },
    });

    await writeConfigPatch(octokit, "o", "r", { state: null });

    expect(lastWritten().state).toBeUndefined();
  });

  it("drops invalid direct writer state input", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      state: { repo: "https://github.com/o/kody-state", path: "r" },
    });

    await writeConfigPatch(octokit, "o", "r", {
      state: { repo: "kody-state", path: "../r" },
    });

    expect(lastWritten().state).toBeUndefined();
  });
});
