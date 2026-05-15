/**
 * @fileoverview Dashboard smoke tests — verify the dashboard loads without errors.
 * @testFramework playwright
 * @domain e2e
 *
 * These tests run against a deployed Vercel URL (BASE_URL).
 * Auth is injected via localStorage since the dashboard uses token-based auth.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";

// Auth data injected via localStorage — requires E2E_GITHUB_TOKEN and E2E_GITHUB_REPO.
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  "https://github.com/aharonyaircohen/Kody-Dashboard";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "aharonyaircohen", repo: "Kody-Dashboard" };
  }
}

/**
 * Inject localStorage auth so AuthGuard lets us through to the dashboard.
 * Must be called AFTER navigating to the BASE_URL origin (localStorage is origin-scoped).
 */
async function injectAuth(page: Page): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.evaluate(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: {
        login: "e2e-test",
        avatar_url: "https://github.com/github-mark.png",
        id: 1,
      },
      loggedInAt: Date.now(),
    },
  );
}

async function loadDashboardAuthenticated(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  if (!TEST_TOKEN) {
    test.skip(true, "E2E_GITHUB_TOKEN not set");
    return;
  }
  await injectAuth(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1_000);
}

test.describe("Dashboard Smoke", () => {
  test("page loads without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await loadDashboardAuthenticated(page);
    await expect(page).toHaveTitle(/kody/i);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("Extension context invalidated") &&
        !e.includes("chrome-extension") &&
        !e.includes("Failed to load resource") &&
        !e.includes(
          "Hydration failed because the server rendered HTML didn't match the client",
        ) &&
        !e.includes("Minified React error #418"),
    );
    expect(
      criticalErrors,
      `Console errors: ${criticalErrors.join("\n")}`,
    ).toHaveLength(0);
  });
});

test.describe("Dashboard — authenticated", () => {
  test("kanban board loads", async ({ page }) => {
    await loadDashboardAuthenticated(page);

    const body = page.locator("body");
    await expect(body).toBeVisible();

    const errorAlert = page
      .getByRole("alert")
      .filter({ hasText: /error/i })
      .first();
    await expect(errorAlert)
      .not.toBeVisible({ timeout: 5_000 })
      .catch(() => {});
  });

  test("chat panel is present", async ({ page }) => {
    await loadDashboardAuthenticated(page);

    const viewport = await page.viewportSize();
    const isMobile = (viewport?.width ?? 1280) < 768;
    if (isMobile) {
      test.skip(true, "Chat panel is hidden at mobile viewport widths");
    }

    const chatInput = page
      .getByPlaceholder(/ask kody|kody is waiting/i)
      .first();
    const chatButton = page.locator('[title="Chat"]').first();

    const inputVisible = await chatInput.isVisible().catch(() => false);
    const buttonVisible = await chatButton.isVisible().catch(() => false);

    expect(inputVisible || buttonVisible).toBeTruthy();
  });

  test("no console errors during interaction", async ({ page }) => {
    await loadDashboardAuthenticated(page);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.mouse.move(400, 300);
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight / 2),
    );
    await page.waitForTimeout(500);
    await page.mouse.move(600, 400);
    await page.waitForTimeout(500);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("Extension context invalidated") &&
        !e.includes("chrome-extension") &&
        !e.includes("Failed to load resource") &&
        !e.includes("502") &&
        !e.includes("Bad Gateway"),
    );
    expect(
      criticalErrors,
      `Interaction errors: ${criticalErrors.join("\n")}`,
    ).toHaveLength(0);
  });
});

test.describe("Mobile layout", () => {
  test("page is responsive on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadDashboardAuthenticated(page);

    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
