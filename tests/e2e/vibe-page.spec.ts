/**
 * @fileoverview Vibe page E2E — verifies the Vibe workspace loads, the
 * detail overlay survives tab switching (today's flicker fix), and the
 * vibe-mode chat endpoint no longer prompts the user to "Pick a runner".
 *
 * @testFramework playwright
 * @domain e2e
 *
 * Auth is injected via localStorage (same pattern as dashboard-smoke).
 * Requires E2E_GITHUB_TOKEN and E2E_GITHUB_REPO. BASE_URL points at the
 * deployed dashboard (defaults to local dev).
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3333'
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? ''
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  'https://github.com/aharonyaircohen/Kody-Dashboard'

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url)
    const parts = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
    return { owner: parts[0] ?? '', repo: parts[1] ?? '' }
  } catch {
    return { owner: 'aharonyaircohen', repo: 'Kody-Dashboard' }
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
      user: {
        login: 'e2e-test',
        avatar_url: 'https://github.com/github-mark.png',
        id: 1,
      },
      loggedInAt: Date.now(),
    },
  )
}

async function gotoVibe(page: Page): Promise<void> {
  if (!TEST_TOKEN) {
    test.skip(true, 'E2E_GITHUB_TOKEN not set')
    return
  }
  // localStorage is origin-scoped — hit the origin first so we can write to it.
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('domcontentloaded')
  await injectAuth(page)
  await page.goto(`${BASE_URL}/vibe`)
  await page.waitForLoadState('domcontentloaded')
}

test.describe('Vibe page — smoke', () => {
  test('loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoVibe(page)
    await expect(page).toHaveTitle(/vibe/i)

    // Same allowlist as dashboard-smoke — chrome extension noise,
    // hydration warnings, etc. are not Vibe regressions.
    const critical = errors.filter(
      (e) =>
        !e.includes('Extension context invalidated') &&
        !e.includes('chrome-extension') &&
        !e.includes('Failed to load resource') &&
        !e.includes(
          "Hydration failed because the server rendered HTML didn't match the client",
        ) &&
        !e.includes('Minified React error #418'),
    )
    expect(
      critical,
      `Vibe console errors: ${critical.join('\n')}`,
    ).toHaveLength(0)
  })

  test('preview pane is present', async ({ page }) => {
    await gotoVibe(page)
    // Either the iframe (default preview / task preview set), the default
    // preview editor (empty state), or the "No preview yet" copy — all are
    // valid landing states for a fresh session. Failing here means the
    // preview pane didn't render at all.
    const ok = await Promise.race([
      page.waitForSelector('iframe[title="Preview deployment"]', {
        timeout: 8_000,
      }),
      page
        .getByText(/no preview yet|default preview/i)
        .first()
        .waitFor({ timeout: 8_000 }),
    ]).then(
      () => true,
      () => false,
    )
    expect(ok, 'Preview pane never rendered').toBe(true)
  })
})

test.describe('Vibe page — detail overlay tab switching (regression for tab-strip bug)', () => {
  test('switching to Comments tab does NOT close the overlay or change the URL', async ({
    page,
  }) => {
    await gotoVibe(page)

    // We need a task to open. The list is async — wait for at least one row.
    const issueRow = page
      .getByRole('button', { name: /^#\d+/ })
      .or(page.locator('[data-testid="vibe-issue-row"]'))
      .first()

    const haveTask = await issueRow
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(
        () => true,
        () => false,
      )
    if (!haveTask) {
      test.skip(true, 'No open issues in the connected repo — cannot exercise the detail overlay')
      return
    }

    // The list row has a separate "open details" affordance (info icon /
    // ⓘ button per VibeIssueList). Fall back to double-clicking the row
    // if there's no dedicated button — the goal is to open the detail
    // overlay (URL gains ?detail=N).
    const detailTrigger = page
      .getByRole('button', { name: /open (issue )?details?/i })
      .first()
    const detailVisible = await detailTrigger
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(
        () => true,
        () => false,
      )
    if (detailVisible) {
      await detailTrigger.click()
    } else {
      // Fallback: click the row text itself.
      await issueRow.click({ clickCount: 2 })
    }

    // Wait for the URL to include `detail=`. If it never does, the overlay
    // open trigger didn't work and the rest of the test is moot.
    await page.waitForURL(/[?&]detail=\d+/, { timeout: 5_000 }).catch(() => {})
    const urlBefore = page.url()
    expect(urlBefore, 'detail overlay did not open').toMatch(/[?&]detail=\d+/)

    // The detail dialog has role="dialog" / aria-modal="true".
    const dialog = page.getByRole('dialog', { name: /issue #\d+/i }).first()
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Click the Comments tab inside the dialog.
    const commentsTab = dialog
      .getByRole('tab', { name: /^comments\b/i })
      .first()
    await commentsTab.click()

    // The bug: clicking Comments used to pushState `/{issueNumber}/comments`,
    // which stripped `?detail=N` from /vibe → overlay closed + URL parked
    // on the dashboard route. The fix should keep both stable.
    await page.waitForTimeout(500) // give any spurious nav a moment to fire
    expect(page.url(), 'URL drifted off /vibe after Comments tab click').toMatch(
      /\/vibe([?#]|$)/,
    )
    expect(page.url(), 'detail= param was stripped after Comments tab click').toMatch(
      /[?&]detail=\d+/,
    )
    await expect(dialog, 'detail overlay was closed by the tab switch').toBeVisible()
  })
})

test.describe('Vibe chat — auto-handoff prompt regression', () => {
  test('POST /api/kody/chat/kody with vibeMode does not return the old "Pick a runner" copy', async ({
    request,
  }) => {
    if (!TEST_TOKEN) {
      test.skip(true, 'E2E_GITHUB_TOKEN not set')
      return
    }
    const { owner, repo } = parseRepo(TEST_REPO)

    const res = await request.post(`${BASE_URL}/api/kody/chat/kody`, {
      headers: {
        'content-type': 'application/json',
        'x-kody-token': TEST_TOKEN,
        'x-kody-owner': owner,
        'x-kody-repo': repo,
      },
      data: {
        messages: [
          {
            role: 'user',
            content:
              'Plan is approved — execute this issue. Pick the runner yourself; do not ask me which one.',
          },
        ],
        vibeMode: true,
        task: {
          issueNumber: 1597,
          title: 'E2E probe — auto-handoff regression',
          state: 'open',
          column: 'open',
        },
      },
    })

    // Acceptable: 200 (model configured, streaming reply) or 409 (no
    // chat model configured / API key missing — we fall back gracefully
    // in prod, but a fresh CI repo may not have models wired). 5xx is a
    // real regression.
    expect(
      [200, 409].includes(res.status()),
      `Unexpected status ${res.status()} from /api/kody/chat/kody`,
    ).toBe(true)
    if (res.status() === 409) {
      test.info().annotations.push({
        type: 'note',
        description:
          'Chat models not configured for tester repo — only verified the route is wired, not the LLM output.',
      })
      return
    }

    // Drain the stream (AI SDK toUIMessageStreamResponse). We don't try
    // to assert specific tool calls — LLM nondeterminism makes that
    // flaky. We only assert the killed copy is absent.
    const body = await res.text()
    expect(body).not.toContain('Pick a runner')
    expect(body).not.toContain('Kody Live or Kody Live (Fly)')
  })
})
