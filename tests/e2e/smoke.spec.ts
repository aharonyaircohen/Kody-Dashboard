/**
 * @fileoverview Smoke layer: the key routes load and their core chrome
 * mounts. No deep interactions — this suite must stay fast (`pnpm
 * test:smoke`). Deep behavior lives in the e2e layer (admin-chat-regression,
 * client-chat-surface, chat-live-flow).
 *
 * @testFramework playwright
 * @domain smoke-mocked
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";

async function seedAuth(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    const auth = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "smoke-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:gpt-x",
    );
    localStorage.setItem("kody:chat-first-layout", "0");
  });
}

test.describe("Route smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/kody/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "gpt-x", label: "GPT X", enabled: true }],
        }),
      }),
    );
    await seedAuth(page);
  });

  test("/ mounts the dashboard shell with the chat rail", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('[aria-label="Kody chat"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/chat mounts the admin chat with a composer", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`);
    await page.waitForLoadState("domcontentloaded");
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await expect(chat.locator("textarea").first()).toBeVisible();
  });

  test("/brands keeps the default dashboard page structure", async ({
    page,
  }) => {
    await page.route("**/api/kody/brands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          brands: [
            {
              slug: "acme",
              name: "Acme",
              accent: "#7c3aed",
              locale: "en",
              welcomeText: "Welcome to Acme",
              source: "repo",
              htmlUrl: "https://github.com/test-owner/test-repo/blob/main/brands/acme.json",
            },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/brands`);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "Brands" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[aria-label="Kody chat"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("searchbox", { name: "Search brands" }),
    ).toBeVisible();
    await expect(page.getByText("/client/acme").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open Acme client surface" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Acme", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Public surfaces")).toHaveCount(0);
    await expect(page.locator('[data-testid="chat-panel-brands"]')).toHaveCount(
      0,
    );
  });

});
