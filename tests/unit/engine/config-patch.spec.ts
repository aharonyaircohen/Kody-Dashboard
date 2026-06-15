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
import { writeConfigPatch } from "@dashboard/lib/engine/config";

function octokitWithConfig(config: unknown) {
  const writes: Array<Record<string, unknown>> = [];
  const octokit = {
    rest: {
      repos: {
        getContent: vi.fn().mockResolvedValue({
          data: {
            content: Buffer.from(JSON.stringify(config), "utf-8").toString(
              "base64",
            ),
            sha: "sha-1",
          },
        }),
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
  const lastWritten = () =>
    JSON.parse(
      Buffer.from(writes.at(-1)!.content as string, "base64").toString("utf-8"),
    );
  return { octokit, lastWritten };
}

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
