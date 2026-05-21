/**
 * @fileoverview REPRODUCTION — Bug: Vibe "run a task" runner warms up for
 *   minutes ("Almost ready... 3:24 elapsed") instead of becoming ready fast.
 *
 *   The dashboard's "Almost ready" timer waits for the runner to emit a
 *   `chat.ready` event (written to .kody/events/{taskId}.jsonl). This test
 *   drives the exact handoff endpoint the chat uses
 *   (/api/kody/chat/interactive/start-fly) and measures how long until
 *   chat.ready appears. With the warm pool it should be well under ~90s; the
 *   bug is it takes minutes (or never arrives).
 *
 *   This is a pure REPRODUCTION test — it asserts the bug is fixed; expect it
 *   to FAIL until the warmup is fixed. No product code is touched.
 *
 *   BASE_URL=https://kody-dashboard-sable.vercel.app pnpm test:e2e vibe-runner-warmup
 *
 * @testFramework playwright
 * @domain e2e-live
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://kody-dashboard-sable.vercel.app";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const REPO_URL =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/aharonyaircohen/Kody-Engine-Tester";

function parseRepo(url: string): { owner: string; repo: string } {
  const u = new URL(url);
  const p = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
  return { owner: p[0] ?? "", repo: p[1] ?? "" };
}

const { owner, repo } = parseRepo(REPO_URL);

/** Read .kody/events/{taskId}.jsonl from the repo; [] until first commit. */
async function readEvents(taskId: string): Promise<Array<{ event?: string }>> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
      `.kody/events/${taskId}.jsonl`,
    )}?ref=main`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (res.status === 404) return [];
  if (!res.ok) return [];
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (!body.content) return [];
  const text = Buffer.from(body.content, "base64").toString("utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
}

test.describe("REPRO — Vibe runner warmup", () => {
  test.skip(!TOKEN, "E2E_GITHUB_TOKEN not set");

  test("runner emits chat.ready within 90s of the chat handoff", async ({ request }) => {
    test.setTimeout(6 * 60_000);
    const taskId = `repro-warmup-${Date.now()}`;
    const READY_BUDGET_MS = 90_000;

    const t0 = Date.now();
    // The exact endpoint the Vibe chat hands off to when running a task.
    const start = await request.post(`${BASE_URL}/api/kody/chat/interactive/start-fly`, {
      headers: {
        "x-kody-token": TOKEN,
        "x-kody-owner": owner,
        "x-kody-repo": repo,
        "content-type": "application/json",
      },
      data: { taskId, idleExitMs: 120_000, hardCapMs: 300_000 },
    });
    expect(start.ok(), `start-fly HTTP ${start.status()}`).toBe(true);
    const startBody = (await start.json()) as { runner?: string; machineId?: string };
    // eslint-disable-next-line no-console
    console.log(`[repro-warmup] runner=${startBody.runner} machine=${startBody.machineId}`);

    // Poll the durable event log for chat.ready, measuring elapsed.
    let readyAt = -1;
    const deadline = t0 + 5 * 60_000; // poll up to 5 min so we can REPORT the real time
    while (Date.now() < deadline) {
      const events = await readEvents(taskId);
      if (events.some((e) => e.event === "chat.ready")) {
        readyAt = Date.now() - t0;
        break;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    // eslint-disable-next-line no-console
    console.log(
      `[repro-warmup] chat.ready after ${readyAt < 0 ? ">5min (never)" : `${Math.round(readyAt / 1000)}s`} (runner=${startBody.runner})`,
    );

    expect(
      readyAt >= 0 && readyAt <= READY_BUDGET_MS,
      `runner must be ready within ${READY_BUDGET_MS / 1000}s — was ${
        readyAt < 0 ? "never (>5min)" : `${Math.round(readyAt / 1000)}s`
      }. This reproduces the endless "Almost ready..." warmup.`,
    ).toBe(true);
  });
});
