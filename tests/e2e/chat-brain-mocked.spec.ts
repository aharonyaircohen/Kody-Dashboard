/**
 * @fileoverview Mocked, token-free contract test for the BRAIN chat backend
 * (`/api/kody/chat/brain`) — the one backend without e2e coverage
 * (kody-direct and kody-live are pinned by chat-renderer-output /
 * chat-kody-direct / admin-chat-regression).
 *
 * Brain activation contract: `getStoredBrainConfig()` reads
 * `kody_auth.brain.{url,apiKey}` from localStorage; both present →
 * `brainConfigured` → buildAgentList offers the `brain` entry, and the
 * seeded `kody-default-chat-entry:<owner>/<repo>` = "brain" makes it the
 * default. Wire format (see chat/core/transports/brain.ts): SSE
 * `data: {...}` lines with FULL-snapshot `chat.message` events (content
 * replaces, not appends), `chat.tool_use`, terminal `chat.done` /
 * `chat.error` (mapped to a non-recoverable error bubble
 * `Error: <error>`), plus `seq` for resume bookkeeping.
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
      user: { login: "brain-chat-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
      // Brain activation: BOTH url and apiKey must be present —
      // getStoredBrainConfig() treats partial config as missing.
      brain: { url: "https://brain.example.test", apiKey: "brain-key-123" },
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    // Make Brain the default entry so the composer routes to it without
    // needing the picker on every test.
    localStorage.setItem("kody-default-chat-entry:test-owner/test-repo", "brain");
    localStorage.removeItem("kody-sessions-v3:test-owner/test-repo");
    localStorage.removeItem("kody-sessions-v3");
    // Fresh chat-id pin map — a stale pin would flip includeContext off.
    localStorage.removeItem("kody-brain-chat-ids");
  });
}

test.describe("Brain chat backend (mocked SSE)", () => {
  test.beforeEach(async ({ page }) => {
    // No gateway models — keeps the brain entry unambiguous and skips the
    // "first configured Kody model" default rule.
    await page.route("**/api/kody/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      }),
    );
    await page.route("**/api/kody/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { login: "brain-chat-e2e", avatar_url: "", id: 1 },
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
    await seedAuth(page);
  });

  test("brain entry appears in the picker and is the selected default", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const picker = chat.locator('button[aria-haspopup="listbox"]').first();
    await expect(picker).toBeVisible({ timeout: 15_000 });
    // The seeded default entry key "brain" resolves to AGENT_BRAIN.
    await expect(picker).toContainText(/Kody Brain/i);

    await picker.click();
    const listbox = page.getByRole("listbox").filter({
      has: page.getByRole("option", { name: /Kody Brain/i }),
    });
    await expect(listbox).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: /Kody Brain/i }),
    ).toBeVisible();
    // Live is still offered alongside Brain (single-slot rules only merge
    // Brain↔Brain-Fly and Live↔Live-Fly, never Brain into Live).
    await expect(
      listbox.getByRole("option", { name: /Kody Live/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("send streams brain SSE snapshots and renders the assistant reply", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    let capturedHeaders: Record<string, string> | null = null;
    await page.route("**/api/kody/chat/brain", (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      capturedHeaders = route.request().headers();
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        // Brain replays FULL snapshots (content replaces the bubble), then
        // a completed tool chip, then the terminal done.
        body: sseBody([
          { type: "chat.message", role: "assistant", content: "Hello ", seq: 1 },
          {
            type: "chat.message",
            role: "assistant",
            content: "Hello from the mocked Brain.",
            seq: 2,
          },
          {
            type: "chat.tool_use",
            name: "github_search_code",
            input: { q: "x" },
            seq: 3,
          },
          { type: "chat.done", seq: 4 },
        ]),
      });
    });

    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("hi brain");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(chat.getByText("hi brain").first()).toBeVisible();
    // Snapshot semantics: only the LAST snapshot's text shows (no
    // "Hello Hello from…" concatenation).
    await expect(
      chat.getByText("Hello from the mocked Brain.").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByText(/^Error:/)).toHaveCount(0);
    // Composer is back to idle.
    await expect(chat.getByRole("button", { name: "Stop run" })).toHaveCount(0);

    // Contract of the first POST (BrainTurnConfig.initialBody + headers).
    expect(capturedBody).not.toBeNull();
    const body = capturedBody!;
    expect(typeof body.chatId).toBe("string");
    // chatId = `${userKey}--${repoScopedLogicalKey}` — pin the stable parts.
    expect(String(body.chatId)).toContain("brain-chat-e2e");
    expect(body.message).toBe("hi brain");
    // First turn of a fresh chatId sends the dashboard context once.
    expect(body.includeContext).toBe(true);
    // Per-user Brain credentials ride as headers (brainHeaders()).
    expect(capturedHeaders?.["x-brain-url"]).toBe("https://brain.example.test");
    expect(capturedHeaders?.["x-brain-key"]).toBe("brain-key-123");
    // Repo auth headers ride along like every chat call.
    expect(capturedHeaders?.["x-kody-owner"]).toBe("test-owner");
    expect(capturedHeaders?.["x-kody-repo"]).toBe("test-repo");
  });

  test("chat.error surfaces a terminal error bubble", async ({ page }) => {
    await page.route("**/api/kody/chat/brain", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody([
          { type: "chat.message", role: "assistant", content: "partial", seq: 1 },
          { type: "chat.error", error: "brain profile misconfigured", seq: 2 },
        ]),
      }),
    );

    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });

    const composer = chat.locator("textarea").first();
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("break please");
    await chat.getByRole("button", { name: "Send message" }).click();

    // Non-recoverable mapping (transport-events handler): the in-flight
    // bubble is DROPPED (partial text gone) and replaced by an error
    // bubble with the adapter's `Error: <chat.error.error>` text.
    await expect(
      chat.getByText("Error: brain profile misconfigured"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByText("partial")).toHaveCount(0);
    // Turn settled — composer usable again.
    await expect(chat.locator("textarea").first()).toBeEditable();
  });

  test("Stop aborts an in-flight brain stream and returns to idle", async ({
    page,
  }) => {
    // Never fulfill promptly — the fetch stays pending until Stop aborts it.
    await page.route("**/api/kody/chat/brain", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await route
        .fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
          body: sseBody([{ type: "chat.done", seq: 1 }]),
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

    const stopButton = chat.getByRole("button", { name: "Stop run" });
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    await stopButton.click();

    // AbortError is swallowed by design (placeholder bubble removed, no
    // error bubble), composer back to idle.
    await expect(chat.getByRole("button", { name: "Stop run" })).toHaveCount(0);
    await expect(chat.locator("textarea").first()).toBeEditable();
    await expect(chat.getByText(/^Error:/)).toHaveCount(0);
  });
});
