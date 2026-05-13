/**
 * @fileoverview Login flow E2E tests
 * @testFramework playwright
 * @domain e2e
 *
 * Tests the /login page:
 * 1. Form renders with repo URL + token fields
 * 2. Validation blocks empty submit
 * 3. Invalid token shows error
 * 4. Valid token + repo -> redirects to dashboard
 */

import { test, expect, type Page } from "@playwright/test";

// Set BASE_URL env var to point at a deployed dashboard (Chromium auto-upgrades
// localhost → HTTPS, so the localhost default only works once HTTPS is supported).
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "https://github.com/aharonyaircohen/Kody-Dashboard";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate first, THEN interact with localStorage once the page is ready
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    // Now safe to access localStorage
    await page.evaluate(() => localStorage.removeItem("kody_auth"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("renders login form", async ({ page }) => {
    await expect(page.getByLabel(/repository url/i)).toBeVisible();
    await expect(page.getByLabel(/github personal access token/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /connect to github/i })).toBeVisible();
  });

  test("shows validation error on empty submit", async ({ page }) => {
    // The form has `required` attrs — the button should be disabled
    const button = page.getByRole("button", { name: /connect to github/i });
    await expect(button).toBeDisabled();
  });

  test("shows error for invalid token", async ({ page }) => {
    // Verify the API itself returns the correct error without needing React to re-render
    const apiRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      headers: { "Content-Type": "application/json" },
      data: {
        repoUrl: "https://github.com/aharonyaircohen/Kody-Dashboard",
        token: "invalid-token-that-is-not-real",
      },
    });
    expect(apiRes.status()).toBe(401);
    const body = await apiRes.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid token");

    // Also verify the UI re-enables the button after the error (not permanently stuck on loading)
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => localStorage.removeItem("kody_auth"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.getByLabel(/repository url/i).fill("https://github.com/aharonyaircohen/Kody-Dashboard");
    await page.getByLabel(/github personal access token/i).fill("invalid-token");
    await page.getByRole("button", { name: /connect to github/i }).click();
    // After API returns 401, button should be back to enabled
    await expect(page.getByRole("button", { name: /connect to github/i })).toBeEnabled({ timeout: 15_000 });
  });

  test("redirects to dashboard on valid credentials", async ({ page }) => {
    if (!TEST_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set — cannot test valid login");
    }

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.getByLabel(/repository url/i).fill(TEST_REPO);
    await page.getByLabel(/github personal access token/i).fill(TEST_TOKEN);

    await page.getByRole("button", { name: /connect to github/i }).click();

    // Should redirect to dashboard (root URL)
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15_000 });

    // Auth should be stored in localStorage
    const auth = await page.evaluate(() => localStorage.getItem("kody_auth"));
    expect(auth).not.toBeNull();
    const parsed = JSON.parse(auth!);
    expect(parsed.token).toBe(TEST_TOKEN);
    expect(parsed.owner).toBeTruthy();
    expect(parsed.repo).toBeTruthy();

    // No JS errors
    const jsErrors = errors.filter((e) => !e.includes("radix-") && !e.includes("hydration"));
    expect(jsErrors).toHaveLength(0);
  });
});
