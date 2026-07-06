/**
 * @fileoverview Agent loop target dropdown visual regression.
 * @testFramework playwright
 * @domain e2e
 *
 * Verifies the target picker stays visible when opened near the bottom of the
 * New loop dialog.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: {
    login: "e2e-test",
    avatar_url: "https://github.com/github-mark.png",
    id: 1,
  },
  loggedInAt: Date.now(),
};

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockDashboardApis(page: Page): Promise<void> {
  await page.route("**/api/kody/auth/me", async (route) => {
    await fulfillJson(route, {
      authenticated: true,
      user: {
        login: "e2e-test",
        avatar_url: "https://github.com/github-mark.png",
        githubId: 1,
      },
      owner: "acme",
      repo: "widgets",
    });
  });

  await page.route("**/api/kody/goals/managed", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await fulfillJson(route, {
      goals: [
        {
          id: "web-release",
          path: "todos/web-release.json",
          source: "local",
          recordType: "instance",
          state: {
            version: 1,
            state: "active",
            type: "release",
            destination: {
              outcome: "Release website to production.",
              evidence: ["releasePrExists", "mainMerged", "productionDeployed"],
            },
            capabilities: [
              "release-prepare",
              "release-merge",
              "vercel-production-deploy",
            ],
            route: [
              {
                stage: "release",
                evidence: "releasePrExists",
                capability: "release-prepare",
                implementation: "release-prepare",
              },
            ],
            schedule: "manual",
            stage: "release",
            facts: {},
            blockers: [],
          },
        },
      ],
    });
  });

  await page.route("**/api/kody/capabilities", async (route) => {
    await fulfillJson(route, { capabilities: [] });
  });
}

test.describe("Agent loop target picker", () => {
  test("opens upward instead of being clipped by the modal bottom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 620 });
    await seedAuth(page);
    await mockDashboardApis(page);

    await page.goto("/agent-loops", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Loops" })).toBeVisible();

    await page.getByLabel("New loop").first().click();
    const dialog = page.getByRole("dialog", { name: "New loop" });
    await expect(dialog).toBeVisible();

    const targetButton = dialog.locator("#loop-target");
    await expect(targetButton).toBeVisible();
    await targetButton.click();

    const option = page.getByRole("option", { name: /web-release/i });
    await expect(option).toBeVisible();

    const optionBox = await option.boundingBox();
    const targetBox = await targetButton.boundingBox();
    expect(optionBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const optionBottom = optionBox!.y + optionBox!.height;
    expect(optionBox!.y).toBeGreaterThanOrEqual(0);
    expect(optionBottom).toBeLessThanOrEqual(620);
    expect(optionBottom).toBeLessThanOrEqual(targetBox!.y);
  });
});
