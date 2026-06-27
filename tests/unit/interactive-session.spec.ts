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
  appendUserTurn,
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
  const octokit = {
    repos: {
      get: vi.fn(),
      getContent,
      createOrUpdateFileContents,
    },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: "state-sha" } } })),
      createRef: vi.fn(),
    },
  };
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

describe("appendUserTurn", () => {
  /**
   * Octokit double scoped to appendUserTurn: getContent returns a file with
   * a meta line so existing.content is non-empty; createOrUpdateFileContents
   * follows a status script.
   */
  function makeAppendOctokit(
    createScript: Array<"ok" | number>,
    existingContent = '{"type":"meta","mode":"interactive","createdAt":"2025-01-01T00:00:00.000Z"}\n',
  ) {
    let i = 0;
    const createOrUpdateFileContents = vi.fn(async () => {
      const step = createScript[Math.min(i, createScript.length - 1)]!;
      i += 1;
      if (step === "ok") return { data: {} };
      const err = new Error("sha mismatch") as Error & { status: number };
      err.status = step;
      throw err;
    });
    const getContent = vi.fn(async () => ({
      data: {
        type: "file",
        content: Buffer.from(existingContent).toString("base64"),
        sha: "abc123",
      },
    }));
    const octokit = {
      repos: {
        get: vi.fn(),
        getContent,
        createOrUpdateFileContents,
      },
      git: {
        getRef: vi.fn(async () => ({
          data: { object: { sha: "state-sha" } },
        })),
        createRef: vi.fn(),
      },
    };
    return {
      octokit: octokit as unknown as Octokit,
      createOrUpdateFileContents,
      getContent,
    };
  }

  it("appends once when there is no conflict", async () => {
    const { octokit, createOrUpdateFileContents } = makeAppendOctokit(["ok"]);
    await expect(
      appendUserTurn(octokit, "o", "r", "sess-1", {
        role: "user",
        content: "hello",
        timestamp: "2025-01-01T00:00:00.000Z",
      }),
    ).resolves.toEqual({ turnCount: 1 });
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });

  it("retries on a 409 conflict with backoff and then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const { octokit, createOrUpdateFileContents } = makeAppendOctokit([
        409,
        "ok",
      ]);
      const p = appendUserTurn(octokit, "o", "r", "sess-2", {
        role: "user",
        content: "hello",
        timestamp: "2025-01-01T00:00:00.000Z",
      });
      await vi.runAllTimersAsync();
      await p;
      expect(createOrUpdateFileContents).toHaveBeenCalledTimes(2);
      // First retry: 100 * 1 + random < 100 = jittered ~100-199ms
      // setTimeout is called once to backoff before the retry
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      const delay = setTimeoutSpy.mock.calls[0]![1] as number;
      expect(typeof delay).toBe("number");
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThan(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up and throws after exhausting retries on a persistent 409", async () => {
    const { octokit, createOrUpdateFileContents } = makeAppendOctokit([
      409, 409, 409, 409, 409,
    ]);
    await expect(
      appendUserTurn(
        octokit,
        "o",
        "r",
        "sess-3",
        {
          role: "user",
          content: "hello",
          timestamp: "2025-01-01T00:00:00.000Z",
        },
        "main",
        3,
      ),
    ).rejects.toThrow("sha mismatch");
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-409 error (e.g. 403)", async () => {
    const { octokit, createOrUpdateFileContents } = makeAppendOctokit([403]);
    await expect(
      appendUserTurn(octokit, "o", "r", "sess-4", {
        role: "user",
        content: "hello",
        timestamp: "2025-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow();
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });
});
