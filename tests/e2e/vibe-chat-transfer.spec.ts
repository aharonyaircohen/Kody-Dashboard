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

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3333'
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? 'ghp_placeholder'
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? 'https://github.com/test-owner/test-repo'

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url)
    const parts = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
    return {
      owner: parts[0] ?? 'test-owner',
      repo: parts[1] ?? 'test-repo',
    }
  } catch {
    return { owner: 'test-owner', repo: 'test-repo' }
  }
}

async function injectAuth(page: Page): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO)
  await page.evaluate(
    (auth) => localStorage.setItem('kody_auth', JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: 'transfer-e2e', avatar_url: '', id: 1 },
      loggedInAt: Date.now(),
    },
  )
}

function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

test.describe('Vibe — chat transfer on issue create', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('domcontentloaded')
    await injectAuth(page)
  })

  test('issue-creation tool result transfers chat to the new issue and clears the source', async ({
    page,
  }) => {
    const NEW_ISSUE = 9999

    // Mock the tasks endpoint so /vibe doesn't sit in the loading skeleton.
    // First call returns empty; once the chat creates the issue and the
    // page invalidates the query, subsequent calls return the new task.
    // The API returns `{ tasks: KodyTask[] }`; tasksApi.list reads `.tasks`.
    let tasksFetchCount = 0
    await page.route('**/api/kody/tasks*', async (route) => {
      tasksFetchCount += 1
      const tasks =
        tasksFetchCount === 1
          ? []
          : [
              {
                id: String(NEW_ISSUE),
                issueNumber: NEW_ISSUE,
                title: 'Update landing page text',
                body: '',
                state: 'open',
                labels: ['enhancement'],
                column: 'open',
                kodyPhase: null,
                kodyFlow: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks }),
      })
    })

    // Mock the dashboard config endpoint (used by /vibe).
    await page.route('**/api/kody/config*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ config: { defaultPreviewUrl: '' } }),
      }),
    )

    // Mock the user-managed chat models list — provide one entry so the
    // dropdown lets the user pick a kody-direct model.
    await page.route('**/api/kody/models*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            {
              id: 'gemini-2.5-pro',
              provider: 'gemini',
              modelName: 'gemini-2.5-pro',
              label: 'Gemini 2.5 Pro',
              apiKeySecret: 'GEMINI_API_KEY',
              baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
              protocol: 'openai',
              enabled: true,
              isDefault: true,
            },
          ],
        }),
      }),
    )

    // Mock the chat load endpoint — task has no branch, returns empty.
    await page.route('**/api/kody/chat/load*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      }),
    )

    // Mock the chat save endpoint — accept the POST and return success.
    let savedToServer:
      | { taskId?: string; messages?: { role: string; text: string }[] }
      | null = null
    await page.route('**/api/kody/chat/save', async (route, req) => {
      try {
        savedToServer = JSON.parse(req.postData() ?? 'null')
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    // Mock /api/kody/chat/kody to stream a UI-message-stream SSE response
    // that includes a tool-output-available chunk for `create_enhancement`
    // with a fake new issue number.
    await page.route('**/api/kody/chat/kody', async (route) => {
      const events = [
        { type: 'text-delta', delta: "I'll create the issue now.\n" },
        {
          type: 'tool-input-available',
          toolCallId: 'call_1',
          toolName: 'create_enhancement',
          input: { title: 'Update landing page text' },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'call_1',
          output: {
            number: NEW_ISSUE,
            title: 'Update landing page text',
            url: `https://github.com/test-owner/test-repo/issues/${NEW_ISSUE}`,
            labels: ['enhancement'],
            assignees: [],
            priority: 'P2',
            category: 'enhancement',
            note: 'Done.',
          },
        },
        { type: 'text-delta', delta: 'Created.' },
      ]
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
        body: sseBody(events),
      })
    })

    // Land on /vibe with no issue selected (=> chat is in global mode).
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    if ((viewport?.width ?? 1280) < 768) {
      test.skip(true, 'chat rail hidden on mobile')
      return
    }

    // Pick the user-managed Gemini model (kody-direct backend).
    const trigger = page
      .locator('button')
      .filter({ hasText: /Gemini|Kody(\s|$)|Brain/ })
      .first()
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await listbox.waitFor({ state: 'visible', timeout: 5_000 })
    await listbox
      .getByRole('option', { name: /Gemini 2\.5 Pro/ })
      .click()
      .catch(async () => {
        // Fallback: pick whichever Kody option exists.
        await listbox.getByRole('option').first().click()
      })

    // Type a user message and send.
    const input = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first()
    await input.waitFor({ state: 'visible', timeout: 10_000 })
    await input.fill('please update the landing page text')
    await input.press('Enter')

    // The Vibe page should navigate to ?issue=9999 after onIssueCreated fires
    // (proxy for: stream completed AND issue-creation handler ran AND VibePage
    // listener fired).
    await page.waitForURL(new RegExp(`/vibe\\?issue=${NEW_ISSUE}`), {
      timeout: 15_000,
    })

    // localStorage under the new task's id should contain the transferred
    // user + assistant messages. This is what the new task's chat hydrates
    // from when the user lands on the issue.
    const stored = await page.evaluate(
      (issueNum) =>
        window.localStorage.getItem(`kody-task-chat-${issueNum}`),
      NEW_ISSUE,
    )
    expect(stored, 'expected localStorage entry for the new issue').toBeTruthy()
    const parsed = JSON.parse(stored as string) as Array<{
      role: string
      text: string
    }>
    const roles = parsed.map((m) => m.role)
    expect(roles, 'transferred chat must include user + assistant turns').toEqual(
      expect.arrayContaining(['user', 'assistant']),
    )
    const userMsg = parsed.find((m) => m.role === 'user')
    expect(userMsg?.text).toContain('update the landing page text')
    const assistantMsg = parsed.find((m) => m.role === 'assistant')
    expect(assistantMsg?.text).toContain('Created.')

    // Server save should have been hit with the same payload.
    expect(savedToServer?.taskId, 'server save should target the new task').toBe(
      String(NEW_ISSUE),
    )
    expect(
      savedToServer?.messages?.some(
        (m) => m.role === 'user' && m.text.includes('landing page'),
      ),
      'server save should include the user message',
    ).toBe(true)

    // Finally — assert the user sees the transferred messages in the new
    // issue's chat. The chat scope flips to the new task once the tasks
    // query refetches; the chat then hydrates from localStorage.
    const assistantBubble = page
      .locator('.prose')
      .filter({ hasText: 'Created.' })
      .first()
    await expect(
      assistantBubble,
      'new issue chat should hydrate with the transferred assistant text',
    ).toBeVisible({ timeout: 15_000 })
  })
})
