/**
 * @fileoverview REPRODUCTION — Bug: a Vibe run creates a preview/PR but it
 *   stays EMPTY (no actual change). FAITHFUL to the real chat flow:
 *     1. chat's vibe_start_execution pre-creates a branch + draft PR, then
 *     2. hands off to the runner with vibeMode + taskContext{branch}, whose
 *        follow-up primer hard-pins the runner to push onto THAT existing
 *        branch (do NOT create a new one).
 *   This test replicates that exactly (pre-create branch + draft PR, then
 *   /interactive/start-fly + /interactive/append with vibeMode + taskContext)
 *   and asserts a real change lands on the PRE-CREATED PR. Empty PR = bug.
 *
 *   No product code is touched — pure reproduction.
 *   BASE_URL=https://kody-dashboard-sable.vercel.app pnpm test:e2e vibe-preview-empty
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
const TARGET_FILE = "src/app/(frontend)/page.tsx";

async function gh<T = unknown>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

/** Read .kody/events/{taskId}.jsonl; [] until first commit. */
async function readEvents(taskId: string): Promise<Array<{ event?: string }>> {
  const r = await gh<{ content?: string }>(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(`.kody/events/${taskId}.jsonl`)}?ref=main`,
  );
  if (!r.ok || !r.json.content) return [];
  return Buffer.from(r.json.content, "base64")
    .toString("utf8")
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

test.describe("REPRO — Vibe preview is empty (runner never pushes to the pre-created branch)", () => {
  test.skip(!TOKEN, "E2E_GITHUB_TOKEN not set");

  test("a real change lands on the pre-created vibe branch's draft PR", async ({ request }) => {
    test.setTimeout(9 * 60_000);
    const stamp = Date.now();

    // ── Mirror vibe_start_execution: issue → branch (from default) →
    //    placeholder commit → draft PR. ──────────────────────────────────
    const repoInfo = await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    const base = repoInfo.json.default_branch || "main";
    const baseRef = await gh<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${base}`);
    const baseSha = baseRef.json.object.sha;
    expect(baseSha, "base sha").toBeTruthy();

    const issue = await gh<{ number: number }>(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `REPRO preview-empty ${stamp}`,
        body: `In \`${TARGET_FILE}\`, change the welcome heading text to "REPRO ${stamp}". One-line edit.`,
      }),
    });
    expect(issue.ok, `create issue ${issue.status}`).toBe(true);
    const issueNumber = issue.json.number;
    const branch = `${issueNumber}-repro-preview`;
    const taskId = `vibe-${issueNumber}-${stamp}`;

    const mkBranch = await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    expect(mkBranch.ok || mkBranch.status === 422, `create branch ${mkBranch.status}`).toBe(true);

    // Placeholder commit so the draft PR can open (mirrors "vibe: start session").
    await gh(`/repos/${owner}/${repo}/contents/.kody/vibe-placeholder-${stamp}.txt`, {
      method: "PUT",
      body: JSON.stringify({
        message: "vibe: start session",
        content: Buffer.from(`vibe ${stamp}`).toString("base64"),
        branch,
      }),
    });

    const pr = await gh<{ number: number }>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `Vibe: REPRO ${stamp}`,
        head: branch,
        base,
        body: `Closes #${issueNumber}`,
        draft: true,
      }),
    });
    expect(pr.ok, `create draft PR ${pr.status} ${JSON.stringify(pr.json)}`).toBe(true);
    const prNumber = pr.json.number;
    // eslint-disable-next-line no-console
    console.log(`[repro-empty] issue #${issueNumber} branch=${branch} draftPR #${prNumber} taskId=${taskId}`);

    // ── Hand off to the runner, exactly as the chat does. ───────────────
    const start = await request.post(`${BASE_URL}/api/kody/chat/interactive/start-fly`, {
      headers: { "x-kody-token": TOKEN, "x-kody-owner": owner, "x-kody-repo": repo, "content-type": "application/json" },
      data: { taskId, idleExitMs: 360_000, hardCapMs: 480_000 },
    });
    expect(start.ok(), `start-fly ${start.status()}`).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[repro-empty] runner=${(await start.json()).runner}`);

    // FAITHFUL to the dashboard: the chat composer "stays disabled until the
    // runner emits chat.ready" (KodyChat startInteractiveSession), and the
    // autoKickoff turn is only delivered through that same gated path. So we
    // WAIT for chat.ready before sending the kickoff — exactly like the UI.
    const readyDeadline = Date.now() + 4 * 60_000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      if ((await readEvents(taskId)).some((e) => e.event === "chat.ready")) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    // eslint-disable-next-line no-console
    console.log(`[repro-empty] chat.ready=${ready}`);

    // The dashboard only delivers the kickoff once the runner is ready. If
    // ready never arrives, the kickoff never goes out — which is precisely the
    // bug: the runner sits idle and the preview PR stays empty.
    if (ready) {
      await request.post(`${BASE_URL}/api/kody/chat/interactive/append`, {
        headers: { "x-kody-token": TOKEN, "x-kody-owner": owner, "x-kody-repo": repo, "content-type": "application/json" },
        data: {
          taskId,
          vibeMode: true,
          taskContext: { issueNumber, prNumber, branch },
          content:
            `Implement issue #${issueNumber} now. The plan was approved in the previous chat — do not ask for ` +
            `confirmation again. Change the welcome heading in ${TARGET_FILE} to "REPRO ${stamp}", commit, push to ` +
            `the existing vibe branch, and reply with the commit SHA.`,
        },
      });
    }

    // ── Poll the PRE-CREATED PR for a real change to the target file. ───
    // If the runner never became ready the kickoff was never delivered, so the
    // PR is necessarily empty — only poll when there was actually a kickoff.
    let landed = false;
    if (ready) {
      const deadline = Date.now() + 6 * 60_000;
      while (Date.now() < deadline) {
        const files = await gh<Array<{ filename: string; additions: number }>>(
          `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
        );
        if (files.ok && files.json.some((f) => f.filename === TARGET_FILE && f.additions > 0)) {
          landed = true;
          // eslint-disable-next-line no-console
          console.log(`[repro-empty] change landed on draft PR #${prNumber}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }

    expect(
      landed,
      ready
        ? `runner became ready but never pushed the change to ${TARGET_FILE} on '${branch}' (PR #${prNumber}) within 6min — empty preview.`
        : `runner never emitted chat.ready, so the kickoff turn was never delivered — the preview PR #${prNumber} stays empty. This is the empty-preview bug.`,
    ).toBe(true);
  });
});
