/**
 * @fileoverview E2E for the slash-command menu + expansion in the chat
 *   composer — the feature renamed Prompts→Commands. Mocks the renamed
 *   endpoint (/api/kody/commands) so it runs without GitHub, and doubles as
 *   a rename regression guard: the UI must fetch /api/kody/commands (not the
 *   dead /api/kody/prompts), open the menu, insert "/slug ", and expand
 *   $ARGUMENTS into the dispatched message.
 *
 * Runs against a deployed BASE_URL; skips without E2E_GITHUB_TOKEN and on
 * mobile viewports.
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

const COMMANDS = [
  {
    slug: "plan",
    description: "Draft an implementation plan",
    argumentHint: "<feature>",
    body: "Research first, then plan: $ARGUMENTS",
    source: "builtin" as const,
  },
  {
    slug: "review",
    description: "Review the open PR",
    argumentHint: "",
    body: "Review this PR.",
    source: "builtin" as const,
  },
];

test.describe("Chat — slash commands (Commands feature)", () => {
  test.beforeEach(async ({ page }) => {
    // Rename regression guard: the dead endpoint must never be hit.
    await page.route("**/api/kody/prompts**", (route) =>
      route.fulfill({ status: 404, body: "gone" }),
    );
    await page.route("**/api/kody/commands**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ commands: COMMANDS }),
      }),
    );

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("typing '/' opens the menu from /api/kody/commands and filters", async ({
    page,
  }) => {
    if (!process.env.E2E_GITHUB_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set");
      return;
    }
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|message/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 15_000 });

    await input.fill("/");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("option").filter({ hasText: "/plan" })).toBeVisible();
    await expect(page.getByRole("option").filter({ hasText: "/review" })).toBeVisible();

    // Filter narrows to a single match.
    await input.fill("/pla");
    await expect(page.getByRole("option").filter({ hasText: "/plan" })).toBeVisible();
    await expect(
      page.getByRole("option").filter({ hasText: "/review" }),
    ).toHaveCount(0);
  });

  test("selecting a command inserts '/slug ' into the composer", async ({
    page,
  }) => {
    if (!process.env.E2E_GITHUB_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set");
      return;
    }
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|message/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.fill("/pla");
    await page.getByRole("option").filter({ hasText: "/plan" }).first().click();
    await expect(input).toHaveValue(/^\/plan\s/);
  });

  test("$ARGUMENTS is expanded into the dispatched message", async ({
    page,
  }) => {
    if (!process.env.E2E_GITHUB_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set");
      return;
    }
    let dispatched: unknown = null;
    await page.route("**/api/kody/chat/trigger", async (route, req) => {
      try {
        dispatched = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId: "mock", workflowId: "kody.yml" }),
      });
    });
    await page.route("**/api/kody/events/stream*", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: `data: ${JSON.stringify({ type: "connected", sessionId: "mock" })}\n\n`,
      }),
    );

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      return test.skip(true, "chat hidden on mobile");

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|message/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.fill("/plan dark mode");
    await input.press("Enter");

    await expect.poll(() => dispatched, { timeout: 10_000 }).not.toBeNull();
    const body = dispatched as {
      messages?: Array<{ role: string; content: string }>;
    };
    const sent = body.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(sent).toContain("Research first, then plan: dark mode");
  });
});
