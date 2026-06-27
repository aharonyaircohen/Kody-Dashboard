/**
 * @fileoverview Deterministic reproduction of the "page never switches to the
 * created issue's scope" bug.
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * When the chat creates a vibe issue, the page navigates to ?issue=N and is
 * supposed to flip the chat into that issue's task scope (composer reads
 * "Ask about task #N", the kickoff useEffect can fire, the conversation
 * hydrates). Live, that flip never happens when GitHub's list-issues hasn't
 * caught up yet — the new issue isn't in the tasks response, so resolution
 * must come from the optimistic pin. This test forces that exact condition by
 * mocking /api/kody/tasks to ALWAYS return an empty list, so the only path to
 * task scope is the pin. If the pin path is broken, the composer never leaves
 * the generic "Ask Kody" placeholder — reproducing the bug.
 *
 * Fully mocked — no model, no GitHub, no rate-limit cost.
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
      user: { login: "scope-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test.describe("Vibe — page must flip to task scope after creating an issue", () => {
  test("composer enters task scope via the optimistic pin even when tasks list is empty", async ({
    page,
  }) => {
    const NEW_ISSUE = 4242;

    // The crux: tasks list NEVER contains the new issue (simulates GitHub
    // propagation lag). Scope can only come from the optimistic pin.
    await page.route("**/api/kody/tasks*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks: [] }),
      }),
    );
    await page.route("**/api/kody/config*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ config: { defaultPreviewUrl: "" } }),
      }),
    );
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              id: "chat-model-pro",
              provider: "example",
              modelName: "chat-model-pro",
              label: "Chat Model Pro",
              apiKeySecret: "MY_API_KEY",
              baseURL: "https://api.example.com/v1/",
              protocol: "openai",
              enabled: true,
              isDefault: true,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/kody/chat/global*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      }),
    );
    await page.route("**/api/kody/chat/global", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      }),
    );

    // Turn 1: model creates the issue (no vibe_start_execution — pure create).
    await page.route("**/api/kody/chat/kody", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sse([
          { type: "text-delta", delta: "Filing the issue." },
          {
            type: "tool-input-available",
            toolCallId: "c1",
            toolName: "create_enhancement",
            input: { title: "Scope flip test" },
          },
          {
            type: "tool-output-available",
            toolCallId: "c1",
            output: {
              number: NEW_ISSUE,
              title: "Scope flip test",
              url: `https://github.com/test-owner/test-repo/issues/${NEW_ISSUE}`,
            },
          },
          { type: "text-delta", delta: " Done." },
        ]),
      }),
    );

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768) {
      test.skip(true, "chat rail hidden on mobile");
      return;
    }

    // Pick the kody-direct model.
    const trigger = page
      .locator("button")
      .filter({ hasText: /Kody(\s|$)|Brain|MiniMax|Chat Model/ })
      .first();
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await listbox.waitFor({ state: "visible", timeout: 5_000 });
    await listbox.getByRole("option", { name: /Chat Model Pro/ }).click();

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("create an issue to tweak the homepage");
    await page.getByRole("button", { name: "Send message" }).click();

    // The page should navigate to the new issue.
    await page.waitForURL(new RegExp(`/vibe\\?issue=${NEW_ISSUE}`), {
      timeout: 15_000,
    });

    // THE ASSERTION: the composer must enter task scope for #4242 — driven by
    // the optimistic pin since the tasks list is empty. If the pin path is
    // broken, the placeholder stays the generic "Ask Kody..." and this fails,
    // reproducing the bug.
    await expect
      .poll(
        async () =>
          (await page
            .getByPlaceholder(/ask about task|ask kody|kody is waiting/i)
            .first()
            .getAttribute("placeholder")
            .catch(() => "")) ?? "",
        { timeout: 15_000, intervals: [500] },
      )
      .toMatch(new RegExp(`task #${NEW_ISSUE}`, "i"));
  });
});
