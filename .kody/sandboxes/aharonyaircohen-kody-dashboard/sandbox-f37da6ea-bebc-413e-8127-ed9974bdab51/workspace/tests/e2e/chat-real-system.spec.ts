/**
 * @fileoverview Real-system e2e — exercises the full pipeline:
 *   dashboard UI → /api/kody/chat/trigger → GitHub Actions (kody.yml) →
 *   @kody-ade/kody-engine kody chat → LLM → events committed back →
 *   SSE stream → UI render.
 *
 * @testFramework playwright
 * @domain e2e-real
 *
 * Gated by RUN_REAL_E2E=1 because each test takes 60–120 s and uses real
 * GitHub Actions minutes + provider tokens. Intended for nightly CI.
 *
 * Required env:
 *   BASE_URL             Deployed dashboard (SSO must be off)
 *   E2E_GITHUB_TOKEN     PAT with `repo` + `workflow` for the target repo
 *   E2E_GITHUB_REPO      Full URL, e.g. https://github.com/<owner>/<repo>
 *   E2E_CHAT_MODEL       Optional, e.g. minimax/MiniMax-M2.7-highspeed
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
const RUN_REAL = process.env.RUN_REAL_E2E === "1";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "", repo: "" };
  }
}

async function injectAuth(page: Page): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.evaluate(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: "real-e2e-test", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

test.describe("Real chat flow @real", () => {
  test.skip(!RUN_REAL, "set RUN_REAL_E2E=1 to enable real-system chat e2e");
  test.setTimeout(180_000); // 3 min per test — accounts for runner boot + LLM call

  test.beforeAll(() => {
    if (!BASE_URL || !TEST_TOKEN || !TEST_REPO) {
      test.skip(true, "BASE_URL / E2E_GITHUB_TOKEN / E2E_GITHUB_REPO required");
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("UI send → engine reply committed to target repo within 2 min", async ({
    page,
  }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    // Capture what the browser actually requests so we can distinguish
    // server-side failures from client-side bugs (EventSource auth, bundle
    // cache, etc.).
    const streamRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/kody/events/stream"))
        streamRequests.push(req.url());
    });

    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 15_000 });

    const marker = `RE2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const triggerPromise = page.waitForRequest("**/api/kody/chat/trigger");
    await input.fill(`Reply with exactly "pong ${marker}" and nothing else.`);
    await input.press("Enter");
    const triggerReq = await triggerPromise;
    const triggerBody = JSON.parse(triggerReq.postData() ?? "{}") as {
      taskId?: string;
    };
    const sessionId = triggerBody.taskId;
    expect(sessionId, "UI must send a taskId to /chat/trigger").toBeTruthy();

    // Phase 1 — engine-side ground truth: poll the target repo's events
    // file via GitHub API. If this fails, the server pipeline is broken
    // (dispatch / workflow / kody / commit).
    const { owner, repo } = parseRepo(TEST_REPO);
    const eventsPath = `.kody/events/${sessionId}.jsonl`;
    const deadline = Date.now() + 150_000;

    let markerFound = false;
    while (Date.now() < deadline) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(eventsPath)}?ref=main`,
        {
          headers: {
            accept: "application/vnd.github.v3+json",
            authorization: `token ${TEST_TOKEN}`,
          },
        },
      );
      if (res.status === 200) {
        const data = (await res.json()) as { content?: string };
        const body = data.content
          ? Buffer.from(data.content, "base64").toString("utf-8")
          : "";
        if (new RegExp(`pong\\s+${marker}`, "i").test(body)) {
          markerFound = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(
      markerFound,
      `engine did not emit the marker "pong ${marker}" within 2.5min`,
    ).toBe(true);

    // Phase 2 — browser-side render: once the engine has committed the
    // reply, the SSE stream should surface it to the UI within a few
    // seconds. This catches client-side bugs the server side can't (e.g.
    // EventSource dropping auth headers, bundle cache, state bugs).
    const assistantBubble = page
      .locator(".bg-muted")
      .filter({ has: page.locator(".prose") })
      .filter({ hasText: new RegExp(`pong\\s+${marker}`, "i") })
      .first();

    try {
      await expect(assistantBubble).toBeVisible({ timeout: 30_000 });
    } catch (e) {
      const sample =
        streamRequests[0] ?? "<no /events/stream request was made>";
      const hasAuth = /[?&]token=|[?&]owner=|[?&]repo=/.test(sample);
      throw new Error(
        `engine reply reached the repo but UI never rendered it.\n` +
          `  stream requests made: ${streamRequests.length}\n` +
          `  first stream URL:     ${sample}\n` +
          `  carries query auth?:  ${hasAuth}\n` +
          `  original error:       ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
});
