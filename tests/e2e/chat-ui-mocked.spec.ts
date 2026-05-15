/**
 * @fileoverview UI-only chat tests — mock /api/kody/chat/trigger and
 * /api/kody/events/stream at the Playwright route level so we can assert
 * how the UI reacts to dispatch success/failure and streaming events
 * without ever touching GitHub or spinning up a runner.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";

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

/**
 * Build an SSE response body string from a list of events.
 * Each event becomes one `data: {json}\n\n` frame.
 */
function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test.describe("Chat UI — mocked backend", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("happy path: send dispatches POST with correct payload shape", async ({
    page,
  }) => {
    // Capture the outgoing trigger request to verify the payload shape the
    // client sends — that's what catches "missing taskId" / "extra inputs"
    // regressions from the UI side.
    let capturedBody: unknown = null;
    await page.route("**/api/kody/chat/trigger", async (route, req) => {
      try {
        capturedBody = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          taskId: "mock-session",
          workflowId: "kody.yml",
        }),
      });
    });
    // Pretend the events stream is alive but silent — prevents the UI from
    // treating the connection as broken while we wait for dispatch.
    await page.route("**/api/kody/events/stream*", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body: `data: ${JSON.stringify({ type: "connected", sessionId: "mock-session" })}\n\n`,
      }),
    );

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("ping");
    await input.press("Enter");

    await expect.poll(() => capturedBody, { timeout: 10_000 }).not.toBeNull();
    const body = capturedBody as {
      taskId?: string;
      messages?: Array<{ role: string; content: string }>;
      dashboardUrl?: string;
    };
    expect(body.taskId, "taskId must be present").toBeTruthy();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(
      body.messages?.some((m) => m.role === "user" && m.content === "ping"),
    ).toBe(true);
    expect(
      body.dashboardUrl,
      "dashboardUrl must be sent for ingest auth",
    ).toMatch(/^https?:\/\//);
  });

  test("failure path: dispatch 500 surfaces an error bubble", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/trigger", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "Not Found - https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event",
        }),
      }),
    );

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("hi");
    await input.press("Enter");

    // The UI renders the error as an assistant message (matches current behavior).
    await expect(page.getByText(/Not Found/).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("input stays usable after a trigger success (no freeze)", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/trigger", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          taskId: "mock-usable",
          workflowId: "kody.yml",
        }),
      }),
    );
    await page.route("**/api/kody/events/stream*", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: `data: ${JSON.stringify({ type: "connected", sessionId: "mock-usable" })}\n\n`,
      }),
    );

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("hi");
    await input.press("Enter");

    // After a successful dispatch the input should remain interactable.
    await expect(input).toBeEnabled({ timeout: 10_000 });
  });
});
