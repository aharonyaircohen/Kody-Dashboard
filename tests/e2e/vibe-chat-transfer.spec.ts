/**
 * @fileoverview End-to-end verification for the vibe chat-transfer-on-create
 * behavior: when a `create_*` / `report_bug` tool returns a new issue
 * number, the running conversation must (1) get persisted to that issue's
 * task-chat localStorage entry, (2) the source scope buffer must clear,
 * and (3) the page must navigate to `?issue=N`.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * Strategy: mock /api/kody/chat/kody to return an SSE stream containing
 * a text-delta + a tool-input-available + a tool-output-available chunk
 * whose output is `{ number: 9999, title: ..., url: ... }`. The chat
 * component should detect this and run the transfer logic.
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
      user: { login: "transfer-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test.describe("Vibe — chat transfer on issue create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("issue-creation tool result transfers chat to the new issue and clears the source", async ({
    page,
  }) => {
    const NEW_ISSUE = 9999;

    // Mock the tasks endpoint so /vibe doesn't sit in the loading skeleton.
    // First call returns empty; once the chat creates the issue and the
    // page invalidates the query, subsequent calls return the new task.
    // The API returns `{ tasks: KodyTask[] }`; tasksApi.list reads `.tasks`.
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

    // Mock the dashboard config endpoint (used by /vibe).
    await page.route("**/api/kody/config*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ config: { defaultPreviewUrl: "" } }),
      }),
    );

    // Mock the user-managed chat models list — provide one entry so the
    // dropdown lets the user pick a kody-direct model.
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

    // Mock the chat load endpoint — task has no branch, returns empty.
    await page.route("**/api/kody/chat/load*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      }),
    );

    // Mock the chat save endpoint — accept the POST and return success.
    let savedToServer: {
      taskId?: string;
      messages?: { role: string; text: string }[];
    } | null = null;
    await page.route("**/api/kody/chat/save", async (route, req) => {
      try {
        savedToServer = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    // Mock the interactive runner start endpoint. We need the kickoff
    // assertion below to verify it was hit, but we DON'T want it to
    // actually dispatch a real GitHub Actions workflow_run against the
    // tester repo. Return a synthetic OK so sendText proceeds without
    // hitting the real backend. We also record the call so the test can
    // assert it happened — `waitForRequest` only catches FUTURE matches,
    // and the kickoff can fire before the assertion is registered.
    let interactiveStartCalled = false;
    let interactiveStartTaskId: string | null = null;
    let interactiveStartBody: { content?: string } | null = null;
    await page.route(
      "**/api/kody/chat/interactive/start*",
      async (route, req) => {
        interactiveStartCalled = true;
        try {
          const body = JSON.parse(req.postData() ?? "{}") as {
            taskId?: string;
            content?: string;
          };
          interactiveStartTaskId = body.taskId ?? null;
          interactiveStartBody = body;
        } catch {
          /* ignore */
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            taskId: interactiveStartTaskId ?? "mock-session",
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
    // Also mock the append endpoint so any follow-up turn doesn't 404
    // against a non-existent backend. (The first kody-live turn folds into
    // /start, so append isn't hit for the kickoff itself.)
    await page.route("**/api/kody/chat/interactive/append", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    // Mock /api/kody/chat/kody to stream a UI-message-stream SSE response
    // matching the *real* vibe-mode turn where the agent fires TWO tools
    // in sequence: create_enhancement (which produces the issue number we
    // need to transfer onto) and vibe_start_execution (which embeds a
    // switch_agent directive in its output to flip the chat to
    // kody-live). This exercises the same post-stream code path as
    // production (pendingSwitchAgent + pendingCreatedIssue both set).
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
            url: `https://github.com/test-owner/test-repo/issues/${NEW_ISSUE}`,
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
            prUrl: `https://github.com/test-owner/test-repo/pull/12345`,
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

    // Land on /vibe with no issue selected (=> chat is in global mode).
    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768) {
      test.skip(true, "chat rail hidden on mobile");
      return;
    }

    // Pick the user-managed chat model (kody-direct backend).
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
        // Fallback: pick whichever Kody option exists.
        await listbox.getByRole("option").first().click();
      });

    // Type a user message and send.
    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("please update the landing page text");
    await input.press("Enter");

    // The Vibe page should navigate to ?issue=9999 after onIssueCreated fires
    // (proxy for: stream completed AND issue-creation handler ran AND VibePage
    // listener fired).
    await page.waitForURL(new RegExp(`/vibe\\?issue=${NEW_ISSUE}`), {
      timeout: 15_000,
    });

    // localStorage under the new task's id should contain the transferred
    // user + assistant messages. This is what the new task's chat hydrates
    // from when the user lands on the issue.
    // The task-chat key is repo-scoped (kody-task-chat-<owner/repo>:<id>),
    // so find the entry whose trailing id matches rather than the bare key.
    const stored = await page.evaluate((issueNum) => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("kody-task-chat-")) continue;
        const tail = k.includes(":")
          ? k.slice(k.lastIndexOf(":") + 1)
          : k.slice("kody-task-chat-".length);
        if (tail === String(issueNum)) return localStorage.getItem(k);
      }
      return null;
    }, NEW_ISSUE);
    expect(
      stored,
      "expected localStorage entry for the new issue",
    ).toBeTruthy();
    const parsed = JSON.parse(stored as string) as Array<{
      role: string;
      text: string;
    }>;
    const roles = parsed.map((m) => m.role);
    expect(
      roles,
      "transferred chat must include user + assistant turns",
    ).toEqual(expect.arrayContaining(["user", "assistant"]));
    const userMsg = parsed.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("update the landing page text");
    const assistantMsg = parsed.find((m) => m.role === "assistant");
    expect(assistantMsg?.text).toContain("Created and handed off.");

    // Server save should have been hit with the same payload.
    const saved = savedToServer as {
      taskId?: string;
      messages?: Array<{ role: string; text: string }>;
    } | null;
    expect(saved?.taskId, "server save should target the new task").toBe(
      String(NEW_ISSUE),
    );
    expect(
      saved?.messages?.some(
        (m) => m.role === "user" && m.text.includes("landing page"),
      ),
      "server save should include the user message",
    ).toBe(true);

    // Finally — assert the user sees the transferred messages in the new
    // issue's chat. The chat scope flips to the new task once the tasks
    // query refetches; the chat then hydrates from localStorage.
    await expect(
      page.getByText("Created and handed off.").first(),
      "new issue chat should hydrate with the transferred assistant text",
    ).toBeVisible({ timeout: 15_000 });

    // Regression: the auto-kickoff must dispatch the runner. The
    // useEffect waits for `selectedAgentId === 'kody-live'` AND
    // `context.kind === 'task'` to both land before firing sendText
    // with the autoKickoff string. sendText for kody-live calls
    // /api/kody/chat/interactive/start (workflow_dispatch). Without
    // this assertion the chat-transfer can pass while the kickoff
    // silently no-ops — which was the production symptom: "issue +
    // empty PR, runner never edits". We poll the accumulator instead
    // of waitForRequest because the kickoff can fire before the
    // assertion is reached.
    await expect
      .poll(() => interactiveStartCalled, { timeout: 20_000 })
      .toBe(true);
    // The kickoff is the FIRST kody-live turn in the new scope, so its
    // content is folded into interactive/start (content field) and the
    // separate append is skipped by design — assert on the start body.
    await expect
      .poll(() => interactiveStartBody?.content ?? "", { timeout: 20_000 })
      .toContain("Implement issue now.");
  });

  test("does NOT transfer on an issue-shaped output with no recognized tool name (read-tool safety)", async ({
    page,
  }) => {
    // Deliberate design: issue-creation transfer fires on tool NAME only,
    // never on output shape. Read tools (github_get_issue, _list_issues,
    // _comment_on_issue) return the exact `{ number, url:/issues/... }`
    // shape for EXISTING issues — a shape-based fallback would falsely
    // flag a creation mid-analysis and wipe the session. So a
    // tool-output with no preceding tool-input-available (=> unknown name)
    // must leave the chat exactly where it is. This guards that decision.
    const NEW_ISSUE = 7777;
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
    await page.route("**/api/kody/chat/load*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      }),
    );
    await page.route("**/api/kody/chat/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      }),
    );

    // Mock the stream WITHOUT a `tool-input-available` chunk — only
    // `tool-output-available` with an issue-shaped output. Shape-based
    // detection must still capture the issue number.
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
              url: `https://github.com/test-owner/test-repo/issues/${NEW_ISSUE}`,
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

    // The stream is consumed (reply renders) — proves we processed the
    // orphan tool-output and chose NOT to treat it as a creation.
    await expect(page.getByText("ok").first()).toBeVisible({ timeout: 15_000 });

    // No transfer: the URL must stay on /vibe with no ?issue=7777, and no
    // task-chat must have been written for that issue.
    await page.waitForTimeout(1_500);
    expect(page.url()).not.toContain(`issue=${NEW_ISSUE}`);
    const stored = await page.evaluate((n) => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("kody-task-chat-") && k.endsWith(String(n))) {
          return localStorage.getItem(k);
        }
      }
      return null;
    }, NEW_ISSUE);
    expect(
      stored,
      "a name-less issue-shaped output must NOT trigger a chat transfer",
    ).toBeNull();
  });
});
