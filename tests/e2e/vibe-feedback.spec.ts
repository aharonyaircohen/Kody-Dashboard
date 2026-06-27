/**
 * @fileoverview Regression test for the Vibe "nothing happens" bug: sending the
 *   first message in a fresh chat created a session, whose id-change fired the
 *   reset effect and ABORTED the in-flight request (silent blank bubble). This
 *   asserts the request is NOT aborted and the reply renders.
 * @testFramework playwright
 *   BASE_URL=https://kody-dashboard-sable.vercel.app pnpm test:e2e vibe-feedback
 */
import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  "https://github.com/aharonyaircohen/Kody-Engine-Tester";

function parseRepo(url: string) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
  return { owner: p[0] ?? "", repo: p[1] ?? "" };
}
async function injectAuth(page: Page) {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.evaluate(
    ({ auth, owner, repo }) => {
      const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      localStorage.setItem(
        `kody-default-chat-entry:${repoKey}`,
        "kody:chat-model-pro",
      );
      localStorage.removeItem(`kody-sessions-v3:${repoKey}`);
      localStorage.removeItem("kody-sessions-v3");
    },
    {
      owner,
      repo,
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "e2e", avatar_url: "x", id: 1 },
        loggedInAt: Date.now(),
      },
    },
  );
}

function chatRail(page: Page) {
  return page.locator('[aria-label="Kody chat"]');
}

function chatInput(page: Page) {
  return chatRail(page).locator("textarea").first();
}

test.describe("vibe chat — first message is not self-aborted", () => {
  test.skip(!TEST_TOKEN, "E2E_GITHUB_TOKEN not set");

  test("fresh chat: request survives session creation and the reply renders", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    let aborted = false;
    page.on("requestfailed", (r) => {
      if (
        r.url().includes("/chat/kody") &&
        /abort/i.test(r.failure()?.errorText ?? "")
      )
        aborted = true;
    });
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
    await page.route("**/api/kody/chat/kody", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"text-delta","delta":"Kody Tester Repo reply rendered."}\n\n' +
          "data: [DONE]\n\n",
      });
    });

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    test.skip((viewport?.width ?? 1280) < 768, "chat rail hidden on mobile");

    const input = chatInput(page);
    await expect(input).toBeEditable({ timeout: 30_000 });
    await input.fill('Change the landing text to "Kody Tester Repo"');
    await chatRail(page).getByRole("button", { name: "Send message" }).click();

    // Feedback during the (slow) reasoning/tool phase — never a silent blank.
    await expect(
      page.getByText(/is thinking…/i),
      "thinking indicator must show while the model works",
    ).toBeVisible({ timeout: 30_000 });

    // The actual reply renders (model finds the file / offers to act).
    await expect(
      page
        .getByText(
          /page\.tsx|create an issue|Kody Tester Repo|Welcome to your new project/i,
        )
        .last(),
      "the assistant reply must render",
    ).toBeVisible({ timeout: 120_000 });

    expect(aborted, "the chat request must NOT be self-aborted").toBe(false);
    await page.screenshot({
      path: "test-results/vibe-feedback.png",
      fullPage: true,
    });
  });
});
