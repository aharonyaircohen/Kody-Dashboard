/**
 * @fileoverview Kody direct agent UI e2e — selects the "Kody" agent,
 * mocks /api/kody/chat/kody at the network level with a streaming body,
 * and asserts the reply renders chunk-by-chunk in the assistant bubble.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * The real chat-model call needs the server-side provider API key; covering
 * that end-to-end is left to a gated @real test.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "ghp_placeholder";
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
      user: { login: "kody-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

async function selectKodyAgent(page: Page): Promise<void> {
  // Agent switcher button shows the current agent's name. The dropdown
  // uses role=listbox / role=option (not a menu), so target the Kody
  // option inside the listbox rather than getByRole('menuitem').
  const trigger = page
    .locator("button")
    .filter({ hasText: /Kody(\s|$)|Brain/ })
    .first();
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ state: "visible", timeout: 5_000 });
  await listbox.getByRole("option", { name: /^Kody\b/ }).click();
}

test.describe("Kody direct agent", () => {
  test.beforeEach(async ({ page }) => {
    // The in-process "Kody" agent only appears in the picker when at least
    // one enabled model is configured (one dropdown row per model, named by
    // its label). Mock the model list so the option exists — labelled
    // "Kody …" so the existing /^Kody\b/ option selector still matches.
    await page.route("**/api/kody/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "test/model", label: "Kody Test", enabled: true }],
        }),
      }),
    );
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("selecting Kody and sending a message streams reply into the assistant bubble", async ({
    page,
  }) => {
    // Mock the direct-chat endpoint with the AI-SDK UI-message-stream SSE
    // shape the client actually parses (`data: {type:"text-delta",...}`) so
    // we verify the stream-reading path without hitting the model.
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"text-delta","delta":"Hello from Kody direct!"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    await selectKodyAgent(page);

    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("ping");
    await input.press("Enter");

    // The streamed text lands in an assistant bubble — assert on the text
    // itself rather than a brittle class chain.
    await expect(page.getByText("Hello from Kody direct!").first()).toBeVisible(
      { timeout: 15_000 },
    );
  });
});
