/**
 * @fileoverview E2E for the DEFAULT chat path — Kody Live. The composer is
 *   disabled until the runner is "ready", so a turn is a two-step flow:
 *     Start → interactive/start → poll events/poll for `chat.ready`
 *       → composer enables → type → interactive/append
 *       → poll returns `chat.message` → assistant bubble renders.
 *
 *   Fully mocked at the route level (interactive/start, events/poll,
 *   interactive/append) so it runs without GitHub or a real runner. This
 *   replaces the older chat-ui-mocked spec, which mocked the /trigger + SSE
 *   flow the default UI no longer drives (so it could never find the
 *   now-Start-gated composer).
 *
 * Runs against a deployed BASE_URL; skips without E2E_GITHUB_TOKEN and on
 * mobile viewports.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "ghp_e2e-test-placeholder";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/test-owner/test-repo";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "test-owner", repo: parts[1] ?? "test-repo" };
  } catch {
    return { owner: "test-owner", repo: "test-repo" };
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
      user: { login: "ui-mock-test", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

function ndjson(events: unknown[]): string {
  return JSON.stringify({
    lines: events.map((e) => JSON.stringify(e)),
    totalLines: events.length,
  });
}

interface Harness {
  /** Most recent interactive/append request body. */
  appendBody: () => Record<string, unknown> | null;
  appended: () => boolean;
}

/**
 * Mock the live-runner endpoints and boot the runner to "ready".
 * `appendResponder` lets a test control the append outcome (e.g. 500).
 * `reply` is delivered via the poll once the turn is appended.
 */
async function bootRunner(
  page: Page,
  opts: {
    appendResponder?: (route: Route) => Promise<void> | void;
    reply?: string;
  } = {},
): Promise<Harness> {
  let appended = false;
  let delivered = false;
  let lastBody: Record<string, unknown> | null = null;
  const reply = opts.reply ?? "pong from the runner";

  await page.route("**/api/kody/chat/interactive/start**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, sessionId: "mock-live" }),
    }),
  );
  await page.route(
    "**/api/kody/chat/interactive/append**",
    async (route, req) => {
      appended = true;
      try {
        lastBody = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      if (opts.appendResponder) return opts.appendResponder(route);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    },
  );
  await page.route("**/api/kody/events/poll**", (route) => {
    const events: unknown[] = [{ event: "chat.ready", payload: {} }];
    if (appended && !delivered) {
      delivered = true;
      events.push({
        event: "chat.message",
        payload: { role: "assistant", content: reply },
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: ndjson(events),
    });
  });

  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");

  const composer = page.locator("textarea").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await expect(composer).toBeDisabled(); // idle kody-live
  await page.getByRole("button", { name: "Start" }).first().click();
  await expect(composer).toBeEnabled({ timeout: 15_000 });

  return { appendBody: () => lastBody, appended: () => appended };
}

test.describe("Chat — Kody Live default flow (mocked runner)", () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_GITHUB_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set");
      return;
    }
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("a turn round-trips: append carries the message, poll renders the reply", async ({
    page,
  }) => {
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    const h = await bootRunner(page);
    const composer = page.locator("textarea").first();
    await composer.fill("ping");
    await composer.press("Enter");

    await expect.poll(() => h.appended(), { timeout: 10_000 }).toBe(true);
    // Payload shape the runner reads off the session JSONL.
    const body = h.appendBody() ?? {};
    expect(body.taskId, "append must carry the session id").toBeTruthy();
    expect(body.content).toBe("ping");

    await expect(page.getByText("pong from the runner").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("an append failure surfaces an error bubble", async ({ page }) => {
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    await bootRunner(page, {
      appendResponder: (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "boom-append-failure" }),
        }),
    });
    const composer = page.locator("textarea").first();
    await composer.fill("hi");
    await composer.press("Enter");

    await expect(page.getByText(/boom-append-failure/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the composer stays usable after a successful turn (no freeze)", async ({
    page,
  }) => {
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    await bootRunner(page);
    const composer = page.locator("textarea").first();
    await composer.fill("first");
    await composer.press("Enter");
    await expect(page.getByText("pong from the runner").first()).toBeVisible({
      timeout: 15_000,
    });

    // Still editable for the next turn.
    await expect(composer).toBeEnabled();
    await composer.fill("second turn");
    await expect(composer).toHaveValue("second turn");
  });
});
