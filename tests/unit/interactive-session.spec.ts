/**
 * writeSessionMeta tests — focus on the concurrent-start 409 retry.
 *
 * Two Vibe runs starting at once each commit a session file to the same
 * branch; the loser's commit races the branch HEAD and GitHub returns 409
 * ("<path> is at <sha> but expected <sha>"). Without a retry that surfaces as
 * a 500. These tests pin the retry-with-backoff behaviour so that regression
 * can't come back silently.
 */

import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";

import {
  buildMetaLine,
  writeSessionMeta,
} from "@dashboard/lib/interactive-session";

/** Octokit double: getContent always 404 (new file), create follows a script. */
function makeOctokit(createScript: Array<"ok" | number>) {
  let i = 0;
  const createOrUpdateFileContents = vi.fn(async () => {
    const step = createScript[Math.min(i, createScript.length - 1)]!;
    i += 1;
    if (step === "ok") return { data: {} };
    const err = new Error(
      ".kody/sessions/x.jsonl is at abc but expected def",
    ) as Error & { status: number };
    err.status = step;
    throw err;
  });
  const getContent = vi.fn(async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    throw err;
  });
  const octokit = { repos: { getContent, createOrUpdateFileContents } };
  return {
    octokit: octokit as unknown as Octokit,
    createOrUpdateFileContents,
    getContent,
  };
}

const META = buildMetaLine({ idleExitMs: 120_000, hardCapMs: 300_000 });

describe("writeSessionMeta", () => {
  it("commits once when there is no conflict", async () => {
    const { octokit, createOrUpdateFileContents } = makeOctokit(["ok"]);
    await writeSessionMeta(octokit, "o", "r", "sess-1", META);
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });

  it("retries on a 409 conflict and then succeeds", async () => {
    const { octokit, createOrUpdateFileContents, getContent } = makeOctokit([
      409,
      "ok",
    ]);
    await expect(
      writeSessionMeta(octokit, "o", "r", "sess-2", META),
    ).resolves.toBeUndefined();
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(2);
    // sha is re-read before each attempt (branch HEAD may have moved).
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws after exhausting retries on a persistent 409", async () => {
    const { octokit, createOrUpdateFileContents } = makeOctokit([
      409, 409, 409, 409, 409,
    ]);
    await expect(
      writeSessionMeta(octokit, "o", "r", "sess-3", META, "main", 3),
    ).rejects.toThrow(/expected/);
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-409 error (e.g. 403)", async () => {
    const { octokit, createOrUpdateFileContents } = makeOctokit([403]);
    await expect(
      writeSessionMeta(octokit, "o", "r", "sess-4", META),
    ).rejects.toThrow();
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });
});
