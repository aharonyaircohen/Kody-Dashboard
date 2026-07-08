/**
 * @fileoverview Guard the admin Kody chat controls while client chat is added.
 * The client surface must not remove admin model selection, reasoning effort,
 * or sessions from /chat.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_REPO = "https://github.com/test-owner/test-repo";

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
      user: { login: "admin-chat-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:gpt-x",
    );
    localStorage.removeItem("kody-sessions-v3:test-owner/test-repo");
    localStorage.removeItem("kody-sessions-v3");
  });
}

test.describe("Admin Kody chat regression", () => {
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
    await page.route("**/api/kody/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { login: "admin-chat-e2e", avatar_url: "", id: 1 },
        }),
      }),
    );
    // Hermetic default for the commands menu — individual tests override
    // (later page.route registrations take precedence in Playwright).
    await page.route("**/api/kody/commands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ commands: [] }),
      }),
    );
    await seedAuth(page);
  });

  test("/chat keeps models, reasoning, and sessions", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`);
    await page.waitForLoadState("domcontentloaded");

    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const picker = chat.locator('button[aria-haspopup="listbox"]').first();
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await picker.click();

    const listbox = page.getByRole("listbox").filter({
      has: page.getByRole("option", { name: /GPT X|Claude Y|Kody Live/i }),
    });
    await expect(listbox).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: /Kody Live/i }),
    ).toBeVisible();
    await expect(listbox.getByRole("option", { name: /GPT X/i })).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: /Claude Y/i }),
    ).toBeVisible();
    await listbox.getByRole("option", { name: /GPT X/i }).click();

    await expect(
      chat.locator('button[title^="Thinking level"]').first(),
    ).toHaveAttribute("title", /Medium/);
    await expect(
      chat.getByRole("button", { name: "Toggle conversations" }),
    ).toBeVisible();
    await expect(chat.getByRole("button", { name: /Terminal/i })).toBeVisible();
  });

  test("/chat composer is the rich markdown editor and Preview toggles", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    // /chat renders the full-page (railFullscreen) composer, which is the
    // rich MarkdownEditor with a toolbar — not the bare textarea.
    await expect(chat.locator('button[title="Bold"]')).toBeVisible({
      timeout: 15_000,
    });
    const previewButton = chat.locator('button[title="Preview"]');
    await expect(previewButton).toBeVisible();

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeVisible();

    // Preview mode swaps the textarea for the rendered preview pane.
    await previewButton.click();
    await expect(chat.getByText("Nothing to preview")).toBeVisible();
    await expect(chat.locator("textarea")).toHaveCount(0);

    // Back to write mode — textarea returns, no crash.
    await chat.locator('button[title="Write"]').click();
    await expect(chat.locator("textarea").first()).toBeVisible();
    await expect(chat.locator("textarea").first()).toBeEditable();
  });

  test("send streams SSE and renders the assistant reply", async ({ page }) => {
    await page.route("**/api/kody/chat/kody", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: "Hello " },
          { type: "text-delta", delta: "from the mocked stream." },
        ]),
      }),
    );

    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("hi there");
    await chat.getByRole("button", { name: "Send message" }).click();

    // .first(): the text also shows up as the session-sidebar preview.
    await expect(chat.getByText("hi there").first()).toBeVisible();
    await expect(chat.getByText("Hello from the mocked stream.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(chat.getByText(/^Error:/)).toHaveCount(0);
  });

  test("chat POST carries repo + dashboard-page context", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;
    let capturedHeaders: Record<string, string> | null = null;
    await page.route("**/api/kody/chat/kody", (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      capturedHeaders = route.request().headers();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody([{ type: "text-delta", delta: "ack" }]),
      });
    });

    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("context ping");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText("ack")).toBeVisible({ timeout: 15_000 });

    expect(capturedBody).not.toBeNull();
    const body = capturedBody!;
    // Stable payload fields (see KodyChat sendText → /api/kody/chat/kody):
    // agentId + model come from the seeded "kody:gpt-x" default entry;
    // currentPage is the dashboard-page context noun phrase.
    expect(body.agentId).toBe("kody");
    expect(body.model).toBe("gpt-x");
    expect(String(body.currentPage)).toContain("/chat");
    expect(JSON.stringify(body.messages)).toContain("context ping");
    // Repo context rides in the auth headers on every chat call.
    expect(capturedHeaders?.["x-kody-owner"]).toBe("test-owner");
    expect(capturedHeaders?.["x-kody-repo"]).toBe("test-repo");
  });

  test("Stop aborts an in-flight stream and returns to idle", async ({
    page,
  }) => {
    // Never fulfill promptly — the fetch stays pending so the assistant
    // bubble stays in the loading state until Stop aborts it.
    await page.route("**/api/kody/chat/kody", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await route
        .fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
          body: sseBody([{ type: "text-delta", delta: "too late" }]),
        })
        .catch(() => {
          // Client already aborted / page closed — expected.
        });
    });

    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("never finishes");
    await chat.getByRole("button", { name: "Send message" }).click();

    // The trailing button swaps into its Stop role while in flight.
    const stopButton = chat.getByRole("button", { name: "Stop run" });
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    await stopButton.click();

    // Back to idle: stop affordance gone, composer editable again, and no
    // error bubble (AbortError is swallowed by design).
    await expect(chat.getByRole("button", { name: "Stop run" })).toHaveCount(0);
    await expect(chat.locator("textarea").first()).toBeEditable();
    await expect(chat.getByText(/^Error:/)).toHaveCount(0);
  });

  test("AI/Terminal mode toggle renders with AI chat pressed", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const aiButton = chat.getByRole("button", { name: "AI chat", exact: true });
    await expect(aiButton).toBeVisible({ timeout: 15_000 });
    await expect(aiButton).toHaveAttribute("aria-pressed", "true");

    // Do NOT click Terminal — it boots real transports. Presence + state only.
    const terminalButton = chat.getByRole("button", { name: /^Terminal/ });
    await expect(terminalButton).toBeVisible();
    await expect(terminalButton).toHaveAttribute("aria-pressed", "false");
  });

  test("slash menu lists mocked commands and inserts the slug", async ({
    page,
  }) => {
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
    await page.goto(`${BASE_URL}/chat`);
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

  test("attachment and voice affordances mount in the composer row", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    await expect(chat.locator('button[title="Attach files"]')).toBeVisible({
      timeout: 15_000,
    });
    // VoiceButton is gated on agent.supportsVoice (true for the in-process
    // `kody` agent) AND browser STT+TTS support (present in Chromium).
    await expect(
      chat.getByRole("button", { name: "Start voice chat" }),
    ).toBeVisible();
  });

  test("session sidebar toggles and survives New conversation", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    // On /chat the sessions sidebar is OPEN by default (fullscreen chat).
    // "Toggle conversations" therefore closes it first, then reopens it.
    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    const toggle = chat.getByRole("button", { name: "Toggle conversations" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(sidebar).toBeHidden();
    await toggle.click();
    await expect(sidebar).toBeVisible();

    // Two "New conversation" buttons exist (sidebar + chat header) — use
    // the sidebar-scoped one.
    await sidebar.getByRole("button", { name: "New conversation" }).click();
    await expect(sidebar).toBeVisible();
    await expect(chat.locator("textarea").first()).toBeEditable();
  });

  test("ChatRailApi composer injection renders a removable context chip", async ({
    page,
  }) => {
    // Drives the frozen host contract (phase-1 H4) end to end: a page-side
    // feature calls ChatRailApi.setComposerInjection (here: a todo item's
    // "Ask Kody" action), ChatRailShell re-renders KodyChat with the
    // `composerInjection` prop, and the composer renders it as a removable
    // context chip. This is the same path the element-picker browser
    // extension feeds — prop names and semantics are an external contract.
    const todo = {
      slug: "inject-list",
      title: "Inject list",
      description: "",
      items: [
        {
          id: "item-1",
          title: "Wire the header",
          body: "Header wiring details",
          assignee: null,
          completed: false,
          createdAt: "2026-07-01T00:00:00.000Z",
          completedAt: null,
        },
      ],
      createdAt: "2026-07-01T00:00:00.000Z",
      sha: "abc123",
      updatedAt: "2026-07-01T00:00:00.000Z",
      htmlUrl:
        "https://github.com/test-owner/test-repo/blob/kody-state/todos/inject-list.json",
    };
    await page.route("**/api/kody/todos", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ todos: [todo] }),
      }),
    );
    await page.route("**/api/kody/todos/inject-list", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ todo }),
      }),
    );
    await page.route("**/api/kody/collaborators", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ collaborators: [] }),
      }),
    );

    await page.goto(`${BASE_URL}/todos/inject-list`);

    const askKody = page.getByRole("button", {
      name: "Ask Kody about Wire the header",
    });
    await expect(askKody).toBeVisible({ timeout: 15_000 });
    await askKody.click();

    // The chip renders inside the persistent desktop rail chat (the only
    // element carrying the "Kody chat" label on non-chat routes).
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const chip = chat.getByText("Ask Kody: Wire the header");
    await expect(chip).toBeVisible({ timeout: 15_000 });

    // The chip is a removable composer pill, not a sent message.
    await chat
      .getByRole("button", { name: "Remove element context" })
      .first()
      .click();
    await expect(chip).toBeHidden();
  });

  test("/chat mounts exactly one KodyChat instance (regression pin)", async ({
    page,
  }) => {
    // ChatRailShell mounts ONE persistent KodyChat (full-pane on /chat).
    // The mobile sheet only mounts when mobileOpen && !isChatRoute, and
    // app/chat/page.tsx renders null — so on /chat the real count is 1.
    // Pin that: a second mount would double streams and session writes.
    await page.goto(`${BASE_URL}/chat`);
    const roots = page.locator('[data-testid="kody-chat-root"]');
    await expect(roots.first()).toBeVisible({ timeout: 15_000 });
    await expect(roots).toHaveCount(1);
  });
});
