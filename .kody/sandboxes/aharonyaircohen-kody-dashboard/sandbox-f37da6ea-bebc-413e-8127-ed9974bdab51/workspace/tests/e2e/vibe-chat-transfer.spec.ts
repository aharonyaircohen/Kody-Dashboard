/**
 * @fileoverview End-to-end verification for the unified-chat-thread behavior
 * on issue creation (issue #66). When a `create_*` / `report_bug` tool
 * returns a new issue number, the chat thread must STAY in the global
 * session store (`kody-sessions-v3:<owner>/<repo>`) — the page navigates
 * to `?issue=N`, but the conversation continues uninterrupted. The
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
 * the global session now carries the system-prompt flag for the next
 * turn — but no per-task migration runs.
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
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: "unified-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const GLOBAL_SESSIONS_KEY = (ownerRepo: string): string =>
  `kody-sessions-v3:${ownerRepo}`;

async function readGlobalSessions(
  page: Page,
  ownerRepo: string,
): Promise<{
  activeId: string;
  messagesById: Record<string, Array<{ role: string; text: string }>>;
}> {
  const raw = await page.evaluate(
    (k) => localStorage.getItem(k),
    GLOBAL_SESSIONS_KEY(ownerRepo),
  );
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

test.describe("Vibe — unified chat thread on issue create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("issue-creation tool result keeps the thread in the global session and navigates to the new issue", async ({
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

    let interactiveStartCalled = false;
    let interactiveStartBody: { content?: string } | null = null;
    await page.route(
      "**/api/kody/chat/interactive/start*",
      async (route, req) => {
        interactiveStartCalled = true;
        try {
          interactiveStartBody = JSON.parse(req.postData() ?? "{}") as {
            content?: string;
          };
        } catch {
          /* ignore */
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            taskId: String(NEW_ISSUE),
            mode: "interactive",
            target: {
              owner: "test-owner",
              repo: "test-repo",
              branch: "main",
              workflow: "kody.yml",
            },
          }),
        });
      },
    );
    await page.route("**/api/kody/chat/interactive/append", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    // Two tool calls in sequence: create_enhancement (returns the new
    // issue number) + vibe_start_execution (returns a switch_agent
    // directive that flips the chat to kody-live). This is the production
    // shape of the post-create turn.
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
        {
          type: "tool-input-available",
          toolCallId: "call_2",
          toolName: "vibe_start_execution",
          input: { issueNumber: NEW_ISSUE, targetAgent: "kody-live" },
        },
        {
          type: "tool-output-available",
          toolCallId: "call_2",
          output: {
            action: "switch_agent",
            agentId: "kody-live",
            agentName: "Kody Live",
            reason: "Vibe execution started.",
            autoKickoff: "Implement issue now.",
            autoKickoffIssueNumber: NEW_ISSUE,
            branch: `${NEW_ISSUE}-update-landing-page-text`,
            prNumber: 12345,
            prUrl: `https://github.com/${owner}/${repo}/pull/12345`,
            reused: false,
            note: "Handed off.",
          },
        },
        { type: "text-delta", delta: "Created and handed off." },
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

    const trigger = page
      .locator("button")
      .filter({ hasText: /Kody(\s|$)|Brain/ })
      .first();
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await listbox.waitFor({ state: "visible", timeout: 5_000 });
    await listbox
      .getByRole("option", { name: /Chat Model Pro/ })
      .click()
      .catch(async () => {
        await listbox.getByRole("option").first().click();
      });

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("please update the landing page text");
    await input.press("Enter");

    // The Vibe page should navigate to ?issue=9999 after onIssueCreated
    // fires — the issue-creation handler ran AND VibePage listener fired.
    await page.waitForURL(new RegExp(`/vibe\\?issue=${NEW_ISSUE}`), {
      timeout: 15_000,
    });

    // The conversation must stay in the GLOBAL session store, not migrate
    // to a per-task localStorage key. Active session must contain both
    // the user turn and the assistant turn.
    const global = await readGlobalSessions(page, ownerRepo);
    expect(
      global.activeId,
      "global session store must have an active session after the turn",
    ).toBeTruthy();
    const activeMessages = global.messagesById[global.activeId] ?? [];
    const activeRoles = activeMessages.map((m) => m.role);
    expect(
      activeRoles,
      "global session must contain user + assistant turns",
    ).toEqual(expect.arrayContaining(["user", "assistant"]));
    const userMsg = activeMessages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("update the landing page text");
    const assistantMsg = activeMessages.find((m) => m.role === "assistant");
    expect(assistantMsg?.text).toContain("Created and handed off.");

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
      "no per-task kody-task-chat-* entry should be written — thread stays global",
    ).toBeNull();

    // Regression: the auto-kickoff still dispatches the runner. The
    // useEffect waits for `selectedAgentId === 'kody-live'` AND
    // `context.kind === 'task'` to both land before firing sendText
    // with the autoKickoff string. Without this assertion the unified
    // thread could be passing while the kickoff silently no-ops.
    await expect
      .poll(() => interactiveStartCalled, { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() => interactiveStartBody?.content ?? "", { timeout: 20_000 })
      .toContain("Implement issue now.");

    // Finally — the unified thread is visible: the user can see the
    // assistant turn (now in the global session) on /vibe?issue=9999.
    await expect(
      page.getByText("Created and handed off.").first(),
      "global session messages remain rendered on the new issue page",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("issue-shaped output with no recognized tool name does NOT navigate and leaves the global session intact", async ({
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

    const trigger = page
      .locator("button")
      .filter({ hasText: /Kody(\s|$)|Brain/ })
      .first();
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await listbox.waitFor({ state: "visible", timeout: 5_000 });
    await listbox.getByRole("option", { name: /Chat Model Pro/ }).click();

    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("shape test");
    await input.press("Enter");

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

    // Global session should hold the original user turn + the (non-creating)
    // assistant turn.
    const global = await readGlobalSessions(page, ownerRepo);
    const activeMessages = global.messagesById[global.activeId] ?? [];
    expect(activeMessages.length).toBeGreaterThanOrEqual(2);
    expect(activeMessages[0]?.text).toBe("shape test");
    expect(activeMessages[1]?.text).toBe("ok");
  });
});
