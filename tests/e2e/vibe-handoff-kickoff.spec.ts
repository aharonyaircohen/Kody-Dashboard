/**
 * @fileoverview REPRODUCTION — Bug: the Vibe chat hand-off never delivers the
 *   "do the work" kickoff turn to the runner, so the runner boots, idles, and
 *   the preview PR stays empty. Drives the REAL UI flow (chat → plan → approve
 *   → issue + draft PR → switch to runner → autoKickoff), captures whether the
 *   runner-start and the kickoff turn (/interactive/append) actually fire, and
 *   asserts a real change lands on the PR.
 *
 *   Unlike the backend repro, this exercises the dashboard's client hand-off
 *   (the autoKickoff useEffect + sendText), which is where the gap is.
 *   Expect it to FAIL until the kickoff is delivered. No product code touched.
 *
 *   BASE_URL=https://kody-dashboard-sable.vercel.app pnpm test:e2e vibe-handoff-kickoff
 *
 * @testFramework playwright
 * @domain e2e-live
 */
import { test, expect, type Page } from "@playwright/test";

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

async function injectAuth(page: Page): Promise<void> {
  await page.evaluate(
    (a) => localStorage.setItem("kody_auth", JSON.stringify(a)),
    { repoUrl: REPO_URL, owner, repo, token: TOKEN, user: { login: "e2e", avatar_url: "x", id: 1 }, loggedInAt: Date.now() },
  );
}

async function ghJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  return res.ok ? ((await res.json()) as T) : null;
}

test.describe("REPRO — Vibe chat hand-off delivers the kickoff", () => {
  test.skip(!TOKEN, "E2E_GITHUB_TOKEN not set");

  test("chat → run → a real change lands on the PR", async ({ page }) => {
    test.setTimeout(12 * 60_000);

    // Capture the hand-off network calls.
    let startFlyCalled = false;
    let appendCalled = false;
    const appendBodies: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (r.method() !== "POST") return;
      if (u.includes("/api/kody/chat/interactive/start")) startFlyCalled = true;
      if (u.includes("/api/kody/chat/interactive/append")) {
        appendCalled = true;
        appendBodies.push((r.postData() ?? "").slice(0, 200));
      }
    });

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");
    const vp = await page.viewportSize();
    test.skip((vp?.width ?? 1280) < 768, "chat rail hidden on mobile");

    // Default agent (minimax). Send the request.
    const input = page.getByPlaceholder(/ask kody|kody is waiting|ask about/i).first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    const want = `Kody Tester Repo ${Date.now()}`;
    await input.fill(`Change the landing page heading in ${TARGET_FILE} from "Welcome to your new project." to "${want}".`);
    await input.press("Enter");

    // Approve when asked (or proceed if the agent created the issue directly).
    const approval = page
      .locator(".prose")
      .filter({ hasText: /approve|ship it|want me to|should i|shall i|proceed|go ahead|confirm/i })
      .last();
    await Promise.race([
      approval.waitFor({ state: "visible", timeout: 240_000 }),
      page.waitForURL(/\/vibe\?issue=\d+/, { timeout: 240_000 }),
    ]).catch(() => {});
    if (!new URL(page.url()).searchParams.get("issue")) {
      await input.fill("approve");
      await input.press("Enter");
    }

    // Issue created → URL flips to ?issue=N.
    await page.waitForURL(/\/vibe\?issue=\d+/, { timeout: 300_000 });
    const issueNumber = Number(new URL(page.url()).searchParams.get("issue"));
    // eslint-disable-next-line no-console
    console.log(`[repro-handoff] issue #${issueNumber}`);

    // Give the hand-off time to fire start + the kickoff append.
    await page.waitForTimeout(45_000);
    // eslint-disable-next-line no-console
    console.log(`[repro-handoff] startFlyCalled=${startFlyCalled} appendCalled=${appendCalled} appends=${appendBodies.length}`);

    // Find the PR for this issue and poll for a real change to the target file.
    let prNumber = 0;
    for (let i = 0; i < 12 && !prNumber; i++) {
      const search = await ghJson<{ items: Array<{ number: number }> }>(
        `/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:pr "Closes #${issueNumber}" in:body`)}`,
      );
      if (search?.items.length) prNumber = search.items[0].number;
      else await page.waitForTimeout(5_000);
    }
    expect(prNumber, "a draft PR must exist for the issue").toBeGreaterThan(0);

    const deadline = Date.now() + 7 * 60_000;
    let landed = false;
    while (Date.now() < deadline) {
      const files = await ghJson<Array<{ filename: string; additions: number }>>(
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
      );
      if (files?.some((f) => f.filename === TARGET_FILE && f.additions > 0)) {
        landed = true;
        break;
      }
      await page.waitForTimeout(10_000);
    }

    // eslint-disable-next-line no-console
    console.log(`[repro-handoff] PR #${prNumber} landed=${landed} startFly=${startFlyCalled} append=${appendCalled}`);
    expect(
      landed,
      `chat hand-off must deliver the kickoff and land the change on PR #${prNumber}. ` +
        `startFlyCalled=${startFlyCalled} appendCalled=${appendCalled}. Empty PR reproduces the bug.`,
    ).toBe(true);
  });
});
