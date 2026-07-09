/**
 * @fileoverview Client chat surface. This route is separate from the dashboard
 * shell, but the chat itself is still the real KodyChat component.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function seedAuth(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    const auth = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "client-chat-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:gpt-x",
    );
    localStorage.removeItem("kody-sessions-v3:test-owner/test-repo");
    localStorage.removeItem("kody-sessions-v3");
    localStorage.removeItem("kody-chat:sessions-panel-pinned");
  });
}

test.describe("Client chat surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/kody/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              id: "gpt-x",
              label: "GPT X",
              enabled: true,
              reasoning: {
                default: "medium",
                efforts: [
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                ],
              },
            },
            { id: "claude-y", label: "Claude Y", enabled: true },
          ],
        }),
      }),
    );
    await seedAuth(page);
  });

  test("/client/kody renders one standalone Kody chat", async ({ page }) => {
    await page.route("**/api/kody/chat/kody", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: "Hi! How can I help you today?" },
        ]),
      });
    });
    await page.goto(`${BASE_URL}/client/kody`);
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.locator('[data-testid="client-chat-surface"]'),
    ).toBeVisible({
      timeout: 15_000,
    });
    // Default (en) brand: surface root is explicitly LTR (Step 5.5 locale).
    await expect(
      page.locator('[data-testid="client-chat-surface"]'),
    ).toHaveAttribute("dir", "ltr");
    await expect(page.locator('[data-testid="client-brand-name"]')).toHaveText(
      "Kody",
    );
    // Brand accent flows brand config → branding plugin theme → header
    // inline style (Step 6). #0f766e for the default kody brand.
    await expect(page.locator('[data-testid="client-brand-accent"]')).toHaveCSS(
      "background-color",
      "rgb(15, 118, 110)",
    );
    await expect(
      page.locator('aside[aria-label="Primary navigation"]'),
    ).toHaveCount(0);

    const chats = page.locator('[aria-label="Kody chat"]');
    await expect(chats).toHaveCount(1);
    const chat = chats.first();

    await expect(chat.getByText("Kody", { exact: true })).toHaveCount(0);
    await expect(chat.getByText("GPT X")).toHaveCount(0);
    await expect(chat.getByText("Claude Y")).toHaveCount(0);
    await expect(
      chat.locator('button[title^="Switch assistant"]').first(),
    ).toHaveCount(0);
    await expect(chat.locator('button[title^="Thinking level"]')).toHaveCount(
      0,
    );
    await expect(chat.locator("textarea").first()).toBeEditable();
    await expect(chat.locator('button[title="Bold"]')).toBeVisible();
    await expect(chat.locator('button[title="Preview"]')).toBeVisible();
    await expect(chat.getByRole("button", { name: /Terminal/i })).toHaveCount(
      0,
    );
    await expect(chat.getByText(/Global chat/i)).toHaveCount(0);
    await expect(async () => {
      const box = await chat
        .locator('[data-testid="chat-header-controls"]')
        .boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeLessThanOrEqual(44);
    }).toPass();

    const chatRoot = page.locator('[data-testid="kody-chat-root"]').first();
    await expect(chatRoot).toBeVisible();
    await expect(chatRoot).toHaveCSS("border-left-width", "0px");
    await expect(async () => {
      const surfaceBox = await page
        .locator('[data-testid="client-chat-surface"]')
        .boundingBox();
      const chatBox = await chatRoot.boundingBox();
      expect(surfaceBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(Math.round(chatBox!.width)).toBe(Math.round(surfaceBox!.width));
    }).toPass();

    const sessionSidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sessionSidebar).toHaveCount(0);
    await chat.getByRole("button", { name: "Toggle conversations" }).click();
    await expect(sessionSidebar).toBeVisible();
    await expect(
      sessionSidebar.getByRole("button", { name: /Pin conversations panel/i }),
    ).toHaveCount(0);
    await sessionSidebar
      .getByRole("button", { name: "Close conversations" })
      .click();
    await expect(sessionSidebar).toHaveCount(0);

    let sawOperatorAuth = false;
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route) => {
      const headers = route.request().headers();
      sawOperatorAuth =
        headers["x-kody-token"] === "ghp_placeholder" &&
        headers["x-kody-surface-ticket"] === undefined;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: "Hi! How can I help you today?" },
        ]),
      });
    });

    const composer = chat.locator("textarea").first();
    await composer.fill("hi");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText("Hi! How can I help you today?")).toBeVisible();
    expect(sawOperatorAuth).toBe(true);
    await expect(chat.getByText(/renderer-capable model/i)).toHaveCount(0);
  });

  test("/client/acme renders the themed brand from the branding plugin", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/client/acme`);
    await page.waitForLoadState("domcontentloaded");

    const surface = page.locator('[data-testid="client-chat-surface"]');
    await expect(surface).toBeVisible({ timeout: 15_000 });
    // Themed reference brand (lib/client-brand.ts "acme"): distinct name
    // and accent, both contributed via the branding plugin's theme.
    await expect(page.locator('[data-testid="client-brand-name"]')).toHaveText(
      "Acme",
    );
    await expect(page.locator('[data-testid="client-brand-accent"]')).toHaveCSS(
      "background-color",
      "rgb(124, 58, 237)",
    );
    // Default locale brand — root stays LTR.
    await expect(surface).toHaveAttribute("dir", "ltr");
    // No admin plugin affordances leak in: terminal is absent on /client.
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat.getByRole("button", { name: /Terminal/i })).toHaveCount(
      0,
    );
  });

  test("/client/kody mobile keeps chat reachable when conversations open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.setItem("kody-chat:sessions-panel-pinned", "1");
    });
    await page.goto(`${BASE_URL}/client/kody`);
    await page.waitForLoadState("domcontentloaded");

    const surface = page.locator('[data-testid="client-chat-surface"]');
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const sessionSidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(surface).toBeVisible({ timeout: 15_000 });
    await expect(sessionSidebar).toHaveCount(0);
    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable();
    await expect(chat.locator('button[title="Bold"]')).toHaveCount(0);
    await expect(chat.locator('button[title="Preview"]')).toHaveCount(0);
    await expect(chat.locator('button[title="Split"]')).toHaveCount(0);
    await expect(async () => {
      const box = await composer.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeLessThanOrEqual(48);
    }).toPass();

    await chat.getByRole("button", { name: "Toggle conversations" }).click();
    await expect(sessionSidebar).toBeVisible();

    await expect(async () => {
      const surfaceBox = await surface.boundingBox();
      const sidebarBox = await sessionSidebar.boundingBox();
      expect(surfaceBox).not.toBeNull();
      expect(sidebarBox).not.toBeNull();
      expect(sidebarBox!.width).toBeLessThan(surfaceBox!.width);
    }).toPass();

    await sessionSidebar
      .getByRole("button", { name: "Close conversations" })
      .click();
    await expect(sessionSidebar).toHaveCount(0);
    await expect(composer).toBeEditable();
  });

  test("/client/unknown-brand returns 404", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/client/unknown-brand`);

    expect(response?.status()).toBe(404);
    await expect(
      page.locator('[data-testid="client-chat-surface"]'),
    ).toHaveCount(0);
  });

  test("slash menu lists mocked commands on the client surface", async ({
    page,
  }) => {
    // The commands plugin is registered on /client under the minimal grant
    // (middleware + host-effects), so the slash menu must keep working
    // exactly as it did pre-Step-6.
    await page.route("**/api/kody/commands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          commands: [
            {
              slug: "plan",
              description: "Plan work",
              argumentHint: "",
              body: "x",
              source: "builtin",
            },
          ],
        }),
      }),
    );

    const commandsLoaded = page.waitForResponse("**/api/kody/commands");
    await page.goto(`${BASE_URL}/client/kody`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await commandsLoaded;

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("/");

    const option = chat.getByRole("option", { name: /\/plan/ });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
    await expect(chat.locator("textarea").first()).toHaveValue("/plan ");
  });

  test("/client/kody-he renders an RTL root while per-message dir survives", async ({
    page,
  }) => {
    const hebrewReply = "שלום! איך אפשר לעזור?";
    const hiddenThinking = "<ant_thinking>בודק את ההקשר</ant_thinking>";
    await page.route("**/api/kody/chat/kody", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: `${hiddenThinking}\n${hebrewReply}` },
        ]),
      });
    });
    await page.goto(`${BASE_URL}/client/kody-he`);
    await page.waitForLoadState("domcontentloaded");

    const surface = page.locator('[data-testid="client-chat-surface"]');
    await expect(surface).toBeVisible({ timeout: 15_000 });
    // The he-locale brand flips the surface root to RTL (Step 5.5, plan H7).
    await expect(surface).toHaveAttribute("dir", "rtl");

    // Composer still works under the RTL root.
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable();
    await composer.fill("Hello from an LTR message");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText(hebrewReply)).toBeVisible();
    await expect(chat.getByText(/ant_thinking|בודק את ההקשר/)).toHaveCount(0);

    // Per-message direction is explicit per bubble (getMessageDirection in
    // chat/surface/MessageList.tsx) and must NOT be overridden by the RTL
    // root: the LTR user bubble stays dir="ltr", the Hebrew assistant bubble
    // stays dir="rtl".
    await expect(
      chat.locator('[data-role="user"] > div[dir="ltr"]'),
    ).toBeVisible();
    await expect(
      chat.locator('[data-role="assistant"] > div[dir="rtl"]'),
    ).toBeVisible();
    const assistantBidi = await chat
      .locator('[data-role="assistant"] > div[dir="rtl"]')
      .evaluate((node) => getComputedStyle(node).unicodeBidi);
    expect(assistantBidi).toBe("plaintext");
  });
});
