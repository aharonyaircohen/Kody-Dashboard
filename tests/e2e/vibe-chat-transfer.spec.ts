/**
 * @fileoverview End-to-end verification for the unified-chat-thread behavior
 * on issue creation (issue #66). When a `create_*` / `report_bug` tool
 * returns a new issue number, the Vibe default chat thread must stay visible
 * after the page navigates to `?issue=N`, but the conversation continues
 * uninterrupted. The
 * per-scope system-prompt block (`## Current task = #N`) on the next
 * turn signals the scope change to the model.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * Strategy: mock /api/kody/chat/kody to return an SSE stream containing
 * a text-delta + a tool-input-available + a tool-output-available chunk
 * whose output is `{ number: 9999, title: ..., url: ... }`. The chat
 * component detects the new issue number, the host page navigates, and
 * the same visible session carries the conversation into the selected issue
 * view — but no per-task migration runs.
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
    return {
      owner: parts[0] ?? "test-owner",
      repo: parts[1] ?? "test-repo",
    };
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
        user: { login: "unified-e2e", avatar_url: "", id: 1 },
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

async function sendChatMessage(page: Page, text: string): Promise<void> {
  const input = chatInput(page);
  await expect(input).toBeEditable({ timeout: 10_000 });
  await input.fill(text);
  await chatRail(page).getByRole("button", { name: "Send message" }).click();
}

function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const normalizedOwnerRepo = (ownerRepo: string): string =>
  ownerRepo.toLowerCase();

const GLOBAL_SESSIONS_KEY = (ownerRepo: string): string =>
  `kody-sessions-v3:${normalizedOwnerRepo(ownerRepo)}`;

const VIBE_DEFAULT_SESSIONS_KEY = (ownerRepo: string): string =>
  `kody-sessions-v3-vibe-default:${normalizedOwnerRepo(ownerRepo)}`;

async function readSessions(
  page: Page,
  storageKey: string,
): Promise<{
  activeId: string;
  messagesById: Record<string, Array<{ role: string; text: string }>>;
}> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), storageKey);
  if (!raw) return { activeId: "", messagesById: {} };
  const parsed = JSON.parse(raw) as {
    activeSessionId: string;
    messages: Record<string, Array<{ role: string; text: string }>>;
  };
  return {
    activeId: parsed.activeSessionId ?? "",
    messagesById: parsed.messages ?? {},
  };
}

async function readConversationMessages(
  page: Page,
  ownerRepo: string,
): Promise<Array<{ role: string; text: string }>> {
  const stores = await Promise.all([
    readSessions(page, VIBE_DEFAULT_SESSIONS_KEY(ownerRepo)),
    readSessions(page, GLOBAL_SESSIONS_KEY(ownerRepo)),
  ]);
  return stores.flatMap((store) => store.messagesById[store.activeId] ?? []);
}

test.describe("Vibe — unified chat thread on issue create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("issue-creation tool result keeps the Vibe thread visible and navigates to the new issue", async ({
    page,
  }) => {
    const NEW_ISSUE = 9999;
    const { owner, repo } = parseRepo(TEST_REPO);
    const ownerRepo = `${owner}/${repo}`;

    // First call returns an empty task list (simulates GitHub propagation
    // lag right after creation). Once the chat creates the issue and the
    // page invalidates the query, subsequent calls return the new task.
    let tasksFetchCount = 0;
    await page.route("**/api/kody/tasks*", async (route) => {
      tasksFetchCount += 1;
      const tasks =
        tasksFetchCount === 1
          ? []
          : [
              {
                id: String(NEW_ISSUE),
                issueNumber: NEW_ISSUE,
                title: "Update landing page text",
                body: "",
                state: "open",
                labels: ["enhancement"],
                column: "open",
                kodyPhase: null,
                kodyFlow: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks }),
      });
    });

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

    // The new global route replaces the per-task save/load endpoints.
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

    let executeCalled = false;
    await page.route("**/api/kody/vibe/execute", async (route) => {
      executeCalled = true;
      const body = route.request().postDataJSON() as { issueNumber?: number };
      expect(body.issueNumber).toBe(NEW_ISSUE);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          issueNumber: NEW_ISSUE,
          runner: "fly",
          machineId: "machine-test",
          sessionId: `vibe-issue-${NEW_ISSUE}-test`,
        }),
      });
    });
    await page.route("**/api/kody/chat/interactive/**", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "legacy interactive path disabled" }),
      }),
    );

    await page.route("**/api/kody/chat/kody", async (route) => {
      const events = [
        { type: "text-delta", delta: "I'll create the issue now.\n" },
        {
          type: "tool-input-available",
          toolCallId: "call_1",
          toolName: "create_enhancement",
          input: { title: "Update landing page text" },
        },
        {
          type: "tool-output-available",
          toolCallId: "call_1",
          output: {
            number: NEW_ISSUE,
            title: "Update landing page text",
            url: `https://github.com/${owner}/${repo}/issues/${NEW_ISSUE}`,
            labels: ["enhancement"],
            assignees: [],
            priority: "P2",
            category: "enhancement",
            note: "Done.",
          },
        },
        { type: "text-delta", delta: "Created the issue." },
      ];
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody(events),
      });
    });

    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768) {
      test.skip(true, "chat rail hidden on mobile");
      return;
    }

    await sendChatMessage(page, "please update the landing page text");

    // The Vibe page should navigate to ?issue=9999 after onIssueCreated
    // fires — the issue-creation handler ran AND VibePage listener fired.
    await page.waitForURL(new RegExp(`/vibe\\?issue=${NEW_ISSUE}`), {
      timeout: 15_000,
    });

    // The conversation must stay in a chat session store, not migrate to a
    // per-task localStorage key. Active session must contain both the user
    // turn and the assistant turn.
    let activeMessages: Array<{ role: string; text: string }> = [];
    await expect
      .poll(
        async () => {
          activeMessages = await readConversationMessages(page, ownerRepo);
          return activeMessages.map((m) => m.role).join(",");
        },
        { timeout: 5_000, intervals: [250] },
      )
      .toContain("assistant");
    const activeRoles = activeMessages.map((m) => m.role);
    expect(
      activeRoles,
      "chat session must contain user + assistant turns",
    ).toEqual(expect.arrayContaining(["user", "assistant"]));
    const userMsg = activeMessages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("update the landing page text");
    const assistantMsg = activeMessages.find((m) => m.role === "assistant");
    expect(assistantMsg?.text).toContain("Created the issue.");

    const runButton = page.getByRole("button", {
      name: /run kody on this issue/i,
    });
    await expect(runButton).toBeVisible({ timeout: 15_000 });
    await runButton.click();
    await expect.poll(() => executeCalled, { timeout: 5_000 }).toBe(true);

    // The thread must NOT have been migrated to a per-task localStorage
    // entry — that was the old behavior (#66 unified thread). A
    // `kody-task-chat-*` key for issue 9999 indicates the migration
    // path is still wired up.
    const migratedKey = await page.evaluate((n) => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("kody-task-chat-") && k.endsWith(String(n))) {
          return k;
        }
      }
      return null;
    }, NEW_ISSUE);
    expect(
      migratedKey,
      "no per-task kody-task-chat-* entry should be written",
    ).toBeNull();

    // Finally — the unified thread is visible: the user can see the
    // assistant turn on /vibe?issue=9999.
    await expect(
      page.getByText("Created the issue.").first(),
      "chat session messages remain rendered on the new issue page",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("issue-shaped output with no recognized tool name does NOT navigate and leaves the Vibe session intact", async ({
    page,
  }) => {
    const NEW_ISSUE = 7777;
    const { owner, repo } = parseRepo(TEST_REPO);
    const ownerRepo = `${owner}/${repo}`;

    await page.route("**/api/kody/tasks*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [
            {
              id: String(NEW_ISSUE),
              issueNumber: NEW_ISSUE,
              title: "Shape-only test",
              body: "",
              state: "open",
              labels: [],
              column: "open",
              kodyPhase: null,
              kodyFlow: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
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
              baseURL: "https://example/v1/",
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

    // Mock the stream WITHOUT a `tool-input-available` chunk — only
    // `tool-output-available` with an issue-shaped output. The shape
    // alone must not trigger navigation or thread surgery.
    await page.route("**/api/kody/chat/kody", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: "ok" },
          {
            type: "tool-output-available",
            toolCallId: "orphan",
            output: {
              number: NEW_ISSUE,
              title: "Shape-only test",
              url: `https://github.com/${owner}/${repo}/issues/${NEW_ISSUE}`,
            },
          },
        ]),
      }),
    );

    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768) {
      test.skip(true, "chat rail hidden on mobile");
      return;
    }

    await sendChatMessage(page, "shape test");

    // The stream is consumed (reply renders) — proves the chat processed
    // the orphan tool-output and chose NOT to treat it as a creation.
    await expect(page.getByText("ok").first()).toBeVisible({ timeout: 15_000 });

    // No navigation: the URL must stay on /vibe with no ?issue=7777.
    await page.waitForTimeout(1_500);
    expect(page.url()).not.toContain(`issue=${NEW_ISSUE}`);

    // No per-task localStorage entry should have been written.
    const migratedKey = await page.evaluate((n) => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("kody-task-chat-") && k.endsWith(String(n))) {
          return k;
        }
      }
      return null;
    }, NEW_ISSUE);
    expect(
      migratedKey,
      "a name-less issue-shaped output must NOT trigger any thread migration",
    ).toBeNull();

    // Chat session should hold the original user turn + the (non-creating)
    // assistant turn.
    const activeMessages = await readConversationMessages(page, ownerRepo);
    expect(activeMessages.length).toBeGreaterThanOrEqual(2);
    expect(activeMessages[0]?.text).toBe("shape test");
    expect(activeMessages[1]?.text).toBe("ok");
  });
});
