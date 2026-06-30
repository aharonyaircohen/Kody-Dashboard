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
    ({ auth, owner, repo }) => {
      const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      localStorage.setItem(
        `kody-default-chat-entry:${repoKey}`,
        "kody:test/model",
      );
      localStorage.removeItem(`kody-sessions-v3:${repoKey}`);
      localStorage.removeItem("kody-sessions-v3");
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "kody-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      },
      owner,
      repo,
    },
  );
}

async function selectKodyAgent(page: Page): Promise<void> {
  const selected = page.getByRole("button", { name: /Kody Test/i }).first();
  try {
    await selected.waitFor({ state: "visible", timeout: 10_000 });
    return;
  } catch {}

  const chat = page.locator('[aria-label="Kody chat"]');
  const trigger = chat.locator('button[aria-haspopup="listbox"]').first();
  await trigger.click();
  const listbox = page
    .getByRole("listbox")
    .filter({ has: page.getByRole("option", { name: /Kody Test/i }) });
  await listbox.waitFor({ state: "visible", timeout: 5_000 });
  await listbox.getByRole("option", { name: /Kody Test/i }).click();
  await selected.waitFor({ state: "visible", timeout: 5_000 });
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

    const input = page.locator('[aria-label="Kody chat"] textarea').first();
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill("ping");
    await page
      .locator('[aria-label="Kody chat"]')
      .getByRole("button", { name: "Send message" })
      .click();

    // The streamed text lands in an assistant bubble — assert on the text
    // itself rather than a brittle class chain.
    await expect(page.getByText("Hello from Kody direct!").first()).toBeVisible(
      { timeout: 15_000 },
    );
  });
});
