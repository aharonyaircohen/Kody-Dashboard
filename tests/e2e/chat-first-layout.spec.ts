/**
 * @fileoverview Chat-first layout flip (phase 2 step 2). Mocked, token-free.
 * With the per-user toggle ON (localStorage `kody:chat-first-layout`), the
 * desktop shell flips: chat is the MAIN column and the routed page renders
 * in a collapsible side panel — the route stays the source of truth, so
 * deep links and the back button drive the panel. With the toggle OFF the
 * classic rail layout pins byte-identical (resize handle + fixed-width
 * chat aside, no panel wrapper).
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";

async function seedAuth(
  page: Page,
  { chatFirst }: { chatFirst: boolean },
): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate((enabled) => {
    const auth = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "chat-first-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:gpt-x",
    );
    if (enabled) {
      localStorage.setItem("kody:chat-first-layout", "1");
    } else {
      localStorage.removeItem("kody:chat-first-layout");
    }
  }, chatFirst);
}

test.describe("Chat-first layout (beta toggle)", () => {
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
    await page.route("**/api/kody/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { login: "chat-first-e2e", avatar_url: "", id: 1 },
        }),
      }),
    );
    await page.route("**/api/kody/commands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ commands: [] }),
      }),
    );
    await page.route("**/api/kody/tasks**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks: [], counts: {} }),
      }),
    );
  });

  test("toggle ON: /tasks renders chat as main column with the tasks panel", async ({
    page,
  }) => {
    await seedAuth(page, { chatFirst: true });
    await page.goto(`${BASE_URL}/tasks`);

    // Chat is mounted and is the main column (no fixed-width rail: the
    // resize handle only exists in the classic layout).
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[role="separator"][aria-label="Resize chat"]'),
    ).toHaveCount(0);

    // The routed page renders inside the side panel — and on /tasks it is
    // the TASKS PLUGIN's panel view (phase 2 step 3 pilot), not the raw
    // route children: the plugin wrapper testid proves the route→panel
    // substitution ran, and the board it wraps is the same KodyDashboard.
    const panel = page.locator('[data-testid="chat-first-panel"]');
    await expect(panel).toBeVisible();
    const pluginPanel = panel.locator('[data-testid="chat-panel-tasks"]');
    await expect(pluginPanel).toBeAttached({ timeout: 15_000 });
    await expect(panel.getByText(/New Task/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Collapse hides the panel; expand brings it back.
    await page.getByRole("button", { name: "Collapse panel" }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Expand panel" }).click();
    await expect(panel).toBeVisible();
  });

  test("toggle ON: back button returns the panel to the previous route", async ({
    page,
  }) => {
    await seedAuth(page, { chatFirst: true });
    await page.goto(`${BASE_URL}/tasks`);
    const panel = page.locator('[data-testid="chat-first-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await page.goto(`${BASE_URL}/settings`);
    await expect(panel.getByText("Chat-first layout (beta)")).toBeVisible({
      timeout: 15_000,
    });
    // Non-mapped routes keep raw route-content rendering — the tasks
    // plugin panel only substitutes on /tasks (step 3 pilot scope).
    await expect(
      page.locator('[data-testid="chat-panel-tasks"]'),
    ).toHaveCount(0);

    // Back → the route (source of truth) restores the tasks PLUGIN panel.
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(
      page.locator('[data-testid="chat-panel-tasks"]'),
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      page
        .locator('[data-testid="chat-first-panel"]')
        .getByText(/New Task/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("toggle ON: /chat is chat-only with the panel closed and ONE mount", async ({
    page,
  }) => {
    await seedAuth(page, { chatFirst: true });
    await page.goto(`${BASE_URL}/chat`);
    const roots = page.locator('[data-testid="kody-chat-root"]');
    await expect(roots.first()).toBeVisible({ timeout: 15_000 });
    // Same single desktop mount as the classic layout — the flip changes
    // layout, never the mount count (no doubled streams/session writes).
    await expect(roots).toHaveCount(1);
    await expect(
      page.locator('[data-testid="chat-first-panel"]'),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: /Collapse panel|Expand panel/ }),
    ).toHaveCount(0);
  });

  test("toggle OFF: the classic rail layout pins (explicit regression)", async ({
    page,
  }) => {
    await seedAuth(page, { chatFirst: false });
    await page.goto(`${BASE_URL}/tasks`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    // Classic layout: fixed-width chat aside with its resize handle, and
    // no chat-first panel wrapper anywhere.
    await expect(
      page.locator('[role="separator"][aria-label="Resize chat"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="chat-first-panel"]'),
    ).toHaveCount(0);
    // The tasks plugin panel never renders in the classic layout — /tasks
    // shows the raw route children (byte-identical pre-plugin behavior).
    await expect(
      page.locator('[data-testid="chat-panel-tasks"]'),
    ).toHaveCount(0);
    await expect(page.getByText(/New Task/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // Phase 2 step 4 — every migrated admin page substitutes its plugin's
  // panel view in the flipped layout. ONE test iterates all routes (keeps
  // the gate runtime flat) and asserts the plugin wrapper marker attached
  // inside the chat-first panel; the wrapped page content itself is pinned
  // by each page's own specs and the classic-layout regression above.
  test("toggle ON: migrated page routes render their plugin panels", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const routes: Array<[route: string, slug: string]> = [
      ["/activity", "activity"],
      ["/agency-runs", "agency-runs"],
      ["/agent-goals", "agent-goals"],
      ["/agent-loops", "agent-loops"],
      ["/agents", "agents"],
      ["/capabilities", "capabilities"],
      ["/changelog", "changelog"],
      ["/commands", "commands-page"],
      ["/company", "company"],
      ["/company-intents", "company-intents"],
      ["/config", "config"],
      ["/context", "context"],
      ["/docs", "docs"],
      ["/files", "files"],
      ["/inbox", "inbox"],
      ["/instructions", "instructions"],
      ["/memory", "memory"],
      ["/messages", "messages"],
      ["/models", "models"],
      ["/notifications", "notifications"],
      ["/preview", "preview"],
      ["/reports", "reports"],
      ["/secrets", "secrets"],
      ["/settings", "settings"],
      ["/store-catalog", "store-catalog"],
      ["/todos", "todos"],
      ["/variables", "variables"],
      ["/workflows", "workflows"],
    ];
    // Non-mocked API calls from the wrapped pages must not hang the run —
    // stub everything the beforeEach didn't already mock.
    await page.route("**/api/**", (route) => {
      // Later-registered routes win in Playwright — fall back to the
      // beforeEach mocks for the endpoints they already cover.
      const url = route.request().url();
      if (
        url.includes("/api/kody/models") ||
        url.includes("/api/kody/auth/me") ||
        url.includes("/api/kody/commands") ||
        url.includes("/api/kody/tasks")
      ) {
        return route.fallback();
      }
      // Error status on purpose: pages own graceful error states, while a
      // 200 with an empty body crashes react-query consumers ("Query data
      // cannot be undefined") and Next's dev overlay swallows the panel.
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "mocked" }),
      });
    });
    await seedAuth(page, { chatFirst: true });
    for (const [route, slug] of routes) {
      await page.goto(`${BASE_URL}${route}`);
      const panel = page.locator('[data-testid="chat-first-panel"]');
      await expect(panel, `${route} panel`).toBeVisible({ timeout: 15_000 });
      await expect(
        panel.locator(`[data-testid="chat-panel-${slug}"]`),
        `${route} plugin marker`,
      ).toBeAttached({ timeout: 15_000 });
    }
  });
});
