/**
 * @fileoverview Browser-level repro for Kody chat renderer output.
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * The route is mocked, but the chat rail, SSE parser, rendered-view UI,
 * click handling, and one-click lock all run in the browser.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

const LOCAL_BASE_URL =
  process.env.RENDERER_E2E_BASE_URL ?? "http://127.0.0.1:3333";
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

async function injectAuth(
  page: Page,
  options: { defaultChatEntry?: string | null } = {},
): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.evaluate(
    ({ auth, owner, repo, defaultChatEntry }) => {
      const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      if (defaultChatEntry) {
        localStorage.setItem(
          `kody-default-chat-entry:${repoKey}`,
          defaultChatEntry,
        );
      } else {
        localStorage.removeItem(`kody-default-chat-entry:${repoKey}`);
      }
      localStorage.removeItem(`kody-sessions-v3:${repoKey}`);
      localStorage.removeItem("kody-sessions-v3");
    },
    {
      owner,
      repo,
      defaultChatEntry: Object.prototype.hasOwnProperty.call(
        options,
        "defaultChatEntry",
      )
        ? options.defaultChatEntry
        : "kody:chat-model-pro",
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "renderer-e2e", avatar_url: "", id: 1 },
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

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function mockShellApis(page: Page): Promise<void> {
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
}

function renderedApprovalView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-approval-e2e",
    rendererSlug: "decision-fixture",
    rendererName: "Decision",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Confirm this question?", variant: "title" },
        { type: "text", value: "Should I continue?" },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Approve",
              action: {
                id: "approve",
                label: "Approve",
                response: "approve",
                variant: "primary",
              },
            },
            {
              type: "button",
              label: "Cancel",
              action: { id: "cancel", label: "Cancel", response: "cancel" },
            },
          ],
        },
      ],
    },
    data: {
      title: "Confirm this question?",
      body: "Should I continue?",
      actions: [
        {
          id: "approve",
          label: "Approve",
          response: "approve",
          variant: "primary",
        },
        { id: "cancel", label: "Cancel", response: "cancel" },
      ],
    },
  };
}

function renderedSelectionView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-selection-e2e",
    rendererSlug: "choice-fixture",
    rendererName: "Choice",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Choose a report", variant: "title" },
        { type: "text", value: "Pick one report to open." },
        {
          type: "list",
          children: [
            {
              type: "button",
              label: "CTO Report",
              action: { id: "cto", label: "CTO Report", response: "cto" },
            },
            {
              type: "button",
              label: "Kody Health Check",
              action: {
                id: "health",
                label: "Kody Health Check",
                response: "health",
              },
            },
          ],
        },
      ],
    },
    data: {
      title: "Choose a report",
      body: "Pick one report to open.",
      items: [
        { id: "cto", label: "CTO Report", response: "cto" },
        { id: "health", label: "Kody Health Check", response: "health" },
      ],
    },
  };
}

function renderedMultiSelectionView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-multi-selection-e2e",
    rendererSlug: "bulk-choice-fixture",
    rendererName: "Bulk choice",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Choose reports", variant: "title" },
        { type: "text", value: "Pick every report to open." },
        {
          type: "list",
          children: [
            {
              type: "checkbox",
              name: "selected",
              value: "cto",
              label: "CTO Report",
            },
            {
              type: "checkbox",
              name: "selected",
              value: "health",
              label: "Kody Health Check",
            },
            {
              type: "checkbox",
              name: "selected",
              value: "security",
              label: "Security Audit",
            },
          ],
        },
        { type: "submit", label: "Confirm reports" },
      ],
    },
    data: {
      title: "Choose reports",
      body: "Pick every report to open.",
      items: [
        { id: "cto", label: "CTO Report", response: "cto" },
        { id: "health", label: "Kody Health Check", response: "health" },
        { id: "security", label: "Security Audit", response: "security" },
      ],
    },
  };
}

async function mockChatStream(page: Page): Promise<void> {
  let turn = 0;
  await page.route("**/api/kody/chat/kody", async (route: Route) => {
    turn += 1;
    const body = route.request().postDataJSON() as {
      messages?: Array<{ content?: string }>;
    };
    const latest = body.messages?.at(-1)?.content ?? "";
    const output =
      latest.includes("multiple") && latest.includes("reports")
        ? renderedMultiSelectionView()
        : latest.includes("reports") && latest.includes("select")
          ? renderedSelectionView()
          : turn === 1
            ? renderedApprovalView()
            : { content: "Recorded." };
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: sseBody([
        {
          type: "tool-input-available",
          toolCallId: `tool-${turn}`,
          toolName: output && "action" in output ? "show_view" : "final_answer",
          input:
            output && "action" in output
              ? { purpose: "fixture", data: { title: "Fixture" } }
              : output,
        },
        {
          type: "tool-output-available",
          toolCallId: `tool-${turn}`,
          output,
        },
      ]),
    });
  });
}

async function openChat(
  page: Page,
  options: { defaultChatEntry?: string | null } = {},
): Promise<void> {
  await page.goto(`${LOCAL_BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await injectAuth(page, options);
  await page.goto(LOCAL_BASE_URL);
  await page.waitForLoadState("domcontentloaded");

  const viewport = await page.viewportSize();
  test.skip((viewport?.width ?? 1280) < 768, "chat rail hidden on mobile");

  await expect(chatInput(page)).toBeEditable({ timeout: 10_000 });
}

async function sendChatMessage(page: Page, text: string): Promise<void> {
  await chatInput(page).fill(text);
  await chatRail(page).getByRole("button", { name: "Send message" }).click();
}

test.describe("Kody chat renderer output", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page);
    await mockChatStream(page);
  });

  test("approval request renders a card and locks after one click", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText("Confirm this question?")).toBeVisible();
    await expect(page.getByText("Should I continue?")).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeVisible();

    await approve.click();
    await expect(approve).toBeDisabled();
  });

  test("report selection request renders a selectable list and locks after one click", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "list all reports allow me to select one");

    await expect(page.getByText("Choose a report")).toBeVisible();
    const cto = page.getByRole("button", { name: "CTO Report" });
    await expect(cto).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Kody Health Check" }),
    ).toBeVisible();

    await cto.click();
    await expect(cto).toBeDisabled();
  });

  test("multi-selection request uses checkbox and submit atoms then locks", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "let me select multiple reports");

    await expect(page.getByText("Choose reports")).toBeVisible();
    const cto = page.getByRole("checkbox", { name: "CTO Report" });
    const health = page.getByRole("checkbox", { name: "Kody Health Check" });
    const security = page.getByRole("checkbox", { name: "Security Audit" });
    const confirm = page.getByRole("button", { name: "Confirm reports" });

    await expect(cto).toBeVisible();
    await cto.click();
    await health.click();

    await expect(cto).toBeChecked();
    await expect(health).toBeChecked();
    await expect(security).not.toBeChecked();

    await confirm.click();

    await expect(confirm).toBeDisabled();
    await expect(cto).toBeDisabled();
    await expect(health).toBeDisabled();
  });

  test("approval request uses renderer-capable Kody path when a model exists without a saved default", async ({
    page,
  }) => {
    let directChatCalled = false;
    let liveChatCalled = false;
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      directChatCalled = true;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "tool-input-available",
            toolCallId: "tool-default-kody",
            toolName: "show_view",
            input: { purpose: "fixture", data: { title: "Fixture" } },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-default-kody",
            output: renderedApprovalView(),
          },
        ]),
      });
    });
    await page.route("**/api/kody/chat/interactive/start*", (route) => {
      liveChatCalled = true;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "live path should not handle renderer" }),
      });
    });

    await openChat(page, { defaultChatEntry: null });

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText("Confirm this question?")).toBeVisible();
    expect(directChatCalled).toBe(true);
    expect(liveChatCalled).toBe(false);
  });

  test("failed renderer tool output does not leave a blank assistant reply", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "tool-input-available",
            toolCallId: "tool-render-error",
            toolName: "show_view",
            input: { purpose: "approval-card", data: {} },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-render-error",
            output: { error: "show_view requires data" },
          },
        ]),
      });
    });

    await openChat(page);

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText(/show_view requires data/i)).toBeVisible();
  });

  test("provider invoke markup does not leak into the visible chat", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "reasoning-delta",
            delta:
              'Looking now.\n<invoke name="github_list_tree">]<]minimax[>[<path>/src/app</path>]<]minimax[>[</invoke> ]<]minimax[>[',
          },
          {
            type: "text-delta",
            delta: "The login code is in /src/app.",
          },
        ]),
      });
    });

    await openChat(page);

    await sendChatMessage(page, "find the login code");

    await expect(
      page.getByText("The login code is in /src/app."),
    ).toBeVisible();
    await page.getByRole("button", { name: /thought/i }).click();
    await expect(page.getByText("Looking now.")).toBeVisible();
    await expect(
      page.getByText(/invoke|github_list_tree|minimax|<path>/i),
    ).toHaveCount(0);
  });
});
