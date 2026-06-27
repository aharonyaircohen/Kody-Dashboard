/**
 * @fileoverview CMS adapter selection browser flow.
 * @testFramework playwright
 * @domain e2e
 */

import { expect, test, type Page } from "@playwright/test";

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

async function mockIdentity(page: Page): Promise<void> {
  await page.route("**/api/kody/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          login: "e2e-test",
          avatar_url: "https://github.com/github-mark.png",
          githubId: 1,
        },
        owner: "acme",
        repo: "widgets",
      }),
    });
  });
}

async function mockAdapters(page: Page): Promise<void> {
  await page.route("**/api/kody/cms/adapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        adapters: [
          {
            name: "mongodb",
            label: "MongoDB",
            description: "MongoDB collections",
            supportsSchemaGeneration: true,
            htmlUrl: null,
          },
          {
            name: "github",
            label: "GitHub JSON",
            description: "GitHub JSON documents",
            supportsSchemaGeneration: false,
            htmlUrl: null,
          },
        ],
      }),
    });
  });
}

test.describe("CMS adapter setup", () => {
  test("creates CMS config with the selected Store adapter", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop flow is enough for the adapter selector contract.",
    );

    let createdBody: { adapter?: string } | null = null;

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    await page.route("**/api/kody/cms", async (route) => {
      if (route.request().method() === "POST") {
        createdBody = route.request().postDataJSON() as { adapter?: string };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            cms: {
              configured: true,
              version: 1,
              name: "widgets CMS",
              environment: "default",
              defaultAdapter: createdBody.adapter,
              writePolicy: "read-only",
              permissions: {},
              collections: [],
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cms: { configured: false, collections: [] } }),
      });
    });

    await page.goto("/cms", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "CMS" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("combobox", { name: "CMS adapter" }).click();
    await page.getByRole("option", { name: "GitHub JSON" }).click();
    await page.getByRole("button", { name: "Create CMS config" }).click();

    await expect.poll(() => createdBody?.adapter).toBe("github");
  });

  test("switches adapter after CMS is already configured", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop flow is enough for the adapter selector contract.",
    );

    let patchedBody: { adapter?: string } | null = null;
    let activeAdapter = "mongodb";

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    await page.route("**/api/kody/cms", async (route) => {
      if (route.request().method() === "PATCH") {
        patchedBody = route.request().postDataJSON() as { adapter?: string };
        activeAdapter = patchedBody.adapter ?? activeAdapter;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cms: {
            configured: true,
            version: 1,
            name: "widgets CMS",
            environment: "default",
            defaultAdapter: activeAdapter,
            writePolicy: "read-only",
            permissions: {},
            collections: [],
          },
        }),
      });
    });

    await page.goto("/cms", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "CMS" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "CMS adapter settings" }).click();
    await page.getByRole("combobox", { name: "Default adapter" }).click();
    await page.getByRole("option", { name: "GitHub JSON" }).click();
    await page.getByRole("button", { name: "Save adapter" }).click();

    await expect.poll(() => patchedBody?.adapter).toBe("github");
  });
});
