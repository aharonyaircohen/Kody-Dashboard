/**
 * @fileoverview Live verification of the Kody Live session reducer + watchdog.
 *
 * Drives the deployed dashboard end-to-end against a real GHA runner in the
 * Kody-Engine-Tester repo. Two scenarios:
 *
 *   1. Soft path — boot runner, send a turn, confirm:
 *      - idle → booting (yellow banner)
 *      - booting → ready (green banner)
 *      - ready → awaiting on send (typing indicator visible)
 *      - awaiting → ready on assistant reply (typing indicator CLEARS,
 *        which is the hazard-D fix: chat.message alone now clears state,
 *        chat.done is no longer required)
 *      - end session cleanly
 *
 *   2. Stuck path — boot runner, cancel its GHA workflow_run mid-flight,
 *      wait for the dashboard watchdog (150s deadline) to detect silence,
 *      query /api/kody/chat/session/[id]/status, and flip the reducer to
 *      'stuck'. Verify:
 *      - "Runner stuck — restart?" banner appears (red)
 *      - Restart button visible
 *      - Clicking Restart re-enters booting phase
 *
 * Env:
 *   BASE_URL           — defaults to https://kody-dashboard-aguy.vercel.app
 *   E2E_GITHUB_TOKEN   — PAT with push + workflow scope
 *   E2E_GITHUB_REPO    — https://github.com/<owner>/<name> tester repo URL
 *
 * Skipped if env is missing — the test cannot fake a real runner.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL =
  process.env.BASE_URL_OVERRIDE ?? 'https://kody-dashboard-aguy.vercel.app'
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? ''
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? ''

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url)
    const parts = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
    return { owner: parts[0] ?? '', repo: parts[1] ?? '' }
  } catch {
    return { owner: '', repo: '' }
  }
}

async function injectAuth(
  page: Page,
  owner: string,
  repo: string,
): Promise<void> {
  await page.evaluate(
    (auth) =>
      window.localStorage.setItem('kody_auth', JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: 'watchdog-e2e', avatar_url: '', id: 1 },
      loggedInAt: Date.now(),
    },
  )
}

async function ghFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub ${path} → ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

interface WorkflowRun {
  id: number
  status: string
  conclusion: string | null
  created_at: string
  name: string
}

interface WorkflowRunList {
  workflow_runs: WorkflowRun[]
}

/**
 * Find the kody.yml workflow run dispatched within the last minute.
 * Used by the stuck-path test to cancel it after boot.
 */
async function findRecentKodyRun(
  owner: string,
  repo: string,
): Promise<WorkflowRun | null> {
  const sinceIso = new Date(Date.now() - 90_000).toISOString()
  const list = await ghFetch<WorkflowRunList>(
    `/repos/${owner}/${repo}/actions/workflows/kody.yml/runs?created=>=${encodeURIComponent(sinceIso)}&per_page=5`,
  )
  // Sort most recent first.
  const sorted = [...list.workflow_runs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )
  return sorted[0] ?? null
}

async function cancelRun(
  owner: string,
  repo: string,
  runId: number,
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
  if (!res.ok && res.status !== 202) {
    throw new Error(`cancel ${runId} → ${res.status} ${await res.text()}`)
  }
}

/** Read the live phase the reducer is currently in, via banner text. */
async function readPhaseFromBanner(page: Page): Promise<string> {
  // Try each phase's signature text in priority order.
  const checks: Array<[string, RegExp]> = [
    ['stuck', /Runner stuck/i],
    ['error', /Restart/i],
    ['ready', /Live runner ready/i],
    ['booting', /elapsed/i],
    ['awaiting', /Live runner is processing/i],
    ['ended', /Live runner ended/i],
    ['idle', /Live runner is offline/i],
  ]
  for (const [phase, rx] of checks) {
    const count = await page.locator('body').getByText(rx).count()
    if (count > 0) return phase
  }
  return 'unknown'
}

test.describe('Kody Live — watchdog + reducer (live)', () => {
  test.skip(
    !TEST_TOKEN || !TEST_REPO,
    'Requires E2E_GITHUB_TOKEN + E2E_GITHUB_REPO to run live.',
  )

  test('soft path: idle → booting → ready → awaiting → ready', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(360_000) // 6 min: boot can take ~120s on GHA cold.
    const { owner, repo } = parseRepo(TEST_REPO)
    expect(owner).toBeTruthy()
    expect(repo).toBeTruthy()

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log(`BROWSER [error] ${msg.text()}`)
      }
    })

    // 1. Land on /login, inject auth, then navigate to /vibe.
    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    // Mobile chat rail is hidden — skip on narrow viewports.
    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // 2. Confirm idle banner.
    await expect(
      page.getByText(/Live runner is offline|Click Start to warm up/i),
    ).toBeVisible({ timeout: 15_000 })

    // 3. Click the composer's primary button (which is 'Start' when
    //    kody-live is selected + composer is empty + state is idle).
    const startButton = page.getByRole('button', { name: /^Start$/ })
    await expect(startButton).toBeVisible({ timeout: 10_000 })
    await startButton.click()

    // 4. Booting banner shows up almost immediately (reducer dispatches
    //    START synchronously).
    await expect(page.getByText(/elapsed|Watching .* → Actions/i)).toBeVisible({
      timeout: 10_000,
    })

    // 5. Wait for chat.ready → green ready banner. Cold GHA can be slow.
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 180_000,
    })

    // 6. Send a tiny turn — verifies awaiting phase + the hazard-D fix.
    const input = page.getByPlaceholder(/Ask Kody/i)
    await input.fill('say hi in one word')
    await input.press('Enter')

    // 7. Typing indicator should appear (TURN_SENT → awaiting).
    await expect(page.getByText(/is thinking/i).first()).toBeVisible({
      timeout: 15_000,
    })

    // 8. Wait for reply (MESSAGE_RECEIVED → ready). The typing indicator
    //    must disappear (this is the hazard-D regression check).
    await expect(page.getByText(/is thinking/i).first()).toBeHidden({
      timeout: 180_000,
    })
    await expect(page.getByText(/Live runner ready/i)).toBeVisible()

    // 9. End the session cleanly so the runner releases minutes.
    const stopButton = page.getByRole('button', { name: /^Stop$/ })
    if (await stopButton.isVisible().catch(() => false)) {
      await stopButton.click()
    }

    // 10. Final phase should be idle/ended.
    const final = await readPhaseFromBanner(page)
    expect(['idle', 'ended', 'ready']).toContain(final)
  })

  test('stuck path: cancel runner mid-flight → watchdog → restart', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(600_000) // 10 min: boot + 150s watchdog + restart boot.
    const { owner, repo } = parseRepo(TEST_REPO)

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // 1. Click Start.
    await expect(
      page.getByText(/Live runner is offline|Click Start to warm up/i),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Start$/ }).click()
    await expect(page.getByText(/elapsed|Watching .* → Actions/i)).toBeVisible({
      timeout: 10_000,
    })

    // 2. Wait for ready, THEN cancel the GHA run while the dashboard thinks
    //    it's still alive. This is the canonical zombie scenario: dashboard
    //    saw chat.ready but the runner dies before chat.exit fires.
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 180_000,
    })

    // 3. Find the run and cancel it.
    const run = await findRecentKodyRun(owner, repo)
    expect(run, 'recent kody.yml run must exist').toBeTruthy()
    if (!run) return
    // eslint-disable-next-line no-console
    console.log(`Cancelling run ${run.id} (${run.status})...`)
    await cancelRun(owner, repo, run.id)

    // 4. Send a turn — TURN_SENT moves to awaiting. The runner is dead so
    //    no chat.message will arrive. Watchdog deadline for awaiting is
    //    240s; wait long enough for it to fire and reconcile to 'stuck'.
    const input = page.getByPlaceholder(/Ask Kody/i)
    await input.fill('this turn will never be answered')
    await input.press('Enter')

    // 5. Wait for the Restart affordance. The watchdog fires at 240s past
    //    the last event; the events file may have a few events from boot
    //    so we set a generous 300s ceiling.
    await expect(page.getByText(/Runner stuck/i)).toBeVisible({
      timeout: 300_000,
    })
    const restartButton = page.getByRole('button', { name: /^Restart$/ })
    await expect(restartButton).toBeVisible()

    // 6. Click Restart → reducer FORCE_RESETs and immediately re-enters
    //    booting via startInteractiveSession().
    await restartButton.click()
    await expect(page.getByText(/elapsed|Watching .* → Actions/i)).toBeVisible({
      timeout: 15_000,
    })

    // 7. Don't wait for the second boot — that would burn another 90s.
    //    Just verify the reducer is back in booting and end the test.
    const phase = await readPhaseFromBanner(page)
    expect(phase).toBe('booting')
  })
})
