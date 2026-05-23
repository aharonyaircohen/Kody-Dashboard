/**
 * @fileoverview Unit tests for the operator list helpers in engine/config.
 * @testFramework vitest
 * @domain engine-config
 *
 * Covers normalizeOperators (pure) and writeOperators (merge-not-overwrite:
 * setting github.operators must preserve every other config field, including
 * github.owner/repo, agent.model, and unrelated keys).
 */

import { describe, expect, it, vi } from "vitest";
import {
  normalizeOperators,
  writeOperators,
  readOperators,
} from "@dashboard/lib/engine/config";

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
        createOrUpdateFileContents: vi.fn().mockImplementation(async (p: Record<string, unknown>) => {
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

describe("normalizeOperators", () => {
  it("strips a leading @, trims, drops blanks", () => {
    expect(normalizeOperators(["@alice", "  bob ", "", "  "])).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("de-dupes case-insensitively, keeping first-seen casing/order", () => {
    expect(normalizeOperators(["Alice", "@alice", "BOB", "bob"])).toEqual([
      "Alice",
      "BOB",
    ]);
  });
});

describe("writeOperators", () => {
  it("sets github.operators without clobbering other fields", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      agent: { model: "minimax/MiniMax-M2.7-highspeed" },
      executables: { default: "run" },
      github: { owner: "o", repo: "r" },
      quality: { something: true },
    });

    const res = await writeOperators(octokit, "o", "r", ["@alice", "alice", "bob"]);

    expect(res.operators).toEqual(["alice", "bob"]);
    const written = lastWritten();
    expect(written.github.operators).toEqual(["alice", "bob"]);
    // Merge-not-overwrite: every other field survives.
    expect(written.agent).toEqual({ model: "minimax/MiniMax-M2.7-highspeed" });
    expect(written.github.owner).toBe("o");
    expect(written.github.repo).toBe("r");
    expect(written.quality).toEqual({ something: true });
  });
});

describe("readOperators", () => {
  it("returns a normalized list, empty when unset", async () => {
    const a = octokitWithConfig({ executables: { default: "run" } });
    expect(await readOperators(a.octokit, "o", "r", { force: true })).toEqual([]);

    const b = octokitWithConfig({
      executables: { default: "run" },
      github: { operators: ["@alice", "alice"] },
    });
    expect(await readOperators(b.octokit, "o", "r", { force: true })).toEqual([
      "alice",
    ]);
  });
});
