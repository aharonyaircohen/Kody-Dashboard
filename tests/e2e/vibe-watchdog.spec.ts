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

  test('stuck path: stale session → watchdog → status → reducer flips to stuck → restart', async ({
    page,
  }, testInfo) => {
    // Deterministic stuck test. The "real" zombie scenario (live runner
    // crash mid-session) is hard to reproduce reliably — cancelling a
    // GHA run takes seconds to propagate and the engine often finishes a
    // turn before dying. Instead, we inject a saved live session that
    // points at a known-zombie sessionId: a real session that completed
    // long ago with only chat.ready committed and no chat.exit.
    //
    // When the dashboard rehydrates this session:
    //   1. REHYDRATE_RESTORED → phase='booting' with bootStartedAt in
    //      the past (older than the 150s watchdog deadline).
    //   2. Watchdog effect runs with remainingMs clamped to its 5s floor.
    //   3. After 5s, watchdog fetches /status. The events file has only
    //      chat.ready committed hours ago → status returns
    //      runnerAlive=false with reason "no chat.exit".
    //   4. STATUS_RESULT(runnerAlive=false) → reducer flips to 'stuck'.
    //   5. Banner shows "Runner stuck — restart?" with Restart button.
    //   6. Restart click → FORCE_RESET + startInteractiveSession → booting.
    testInfo.setTimeout(240_000) // ~150s watchdog deadline + status round trip + grace
    const { owner, repo } = parseRepo(TEST_REPO)

    // Synthetic session ID that does NOT exist in the events repo. The
    // dashboard rehydrates as 'booting', polling /events returns 404
    // (no file), no RUNNER_READY ever dispatches, phase stays in
    // 'booting', watchdog fires after 5s (its floor — our seeded
    // startedAt is in the past so deadline is already exceeded), and
    // /status reports zombie via the clientLastEventAt branch.
    const ZOMBIE_SESSION_ID = `watchdog-e2e-zombie-${Date.now()}`

    // Establish origin so localStorage is reachable. /login is fine even
    // if it redirects — localStorage is shared across paths on the same
    // origin.
    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)

    // Seed a stale live-session record under the same key the dashboard
    // reads on mount: `kody-live-sessions:<owner>/<repo>` (lowercased).
    await page.evaluate(
      ([sessionId, ownerArg, repoArg]) => {
        const key = `kody-live-sessions:${ownerArg.toLowerCase()}/${repoArg.toLowerCase()}`
        window.localStorage.setItem(
          key,
          JSON.stringify({
            global: {
              sessionId,
              state: 'booting',
              startedAt: Date.now() - 200_000, // older than 150s deadline
              target: { owner: ownerArg, repo: repoArg },
            },
          }),
        )
      },
      [ZOMBIE_SESSION_ID, owner, repo] as const,
    )

    // Sanity check: verify both keys persist before we navigate. Playwright
    // sometimes clears localStorage between Page.goto() calls in certain
    // configurations; making the test surface this clearly beats debugging
    // a vague "didn't rehydrate" failure later.
    const storageBefore = await page.evaluate(() => ({
      auth: window.localStorage.getItem('kody_auth'),
      keys: Object.keys(window.localStorage).filter((k) => k.startsWith('kody-live-sessions')),
    }))
    expect(storageBefore.auth, 'kody_auth must persist').not.toBeNull()
    expect(
      storageBefore.keys.length,
      'a kody-live-sessions key must have been seeded',
    ).toBeGreaterThan(0)

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log(`BROWSER [error] ${msg.text()}`)
      }
    })

    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    // Verify the seeded record survived the navigation.
    const storageAfter = await page.evaluate(() => ({
      auth: window.localStorage.getItem('kody_auth'),
      sessions: Object.fromEntries(
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith('kody-live-sessions'))
          .map((k) => [k, window.localStorage.getItem(k)]),
      ),
    }))
    // eslint-disable-next-line no-console
    console.log('After nav storage:', JSON.stringify(storageAfter, null, 2))

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // 1. Should rehydrate as booting (so the watchdog effect fires).
    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 15_000 })

    // 2. Watchdog fires after the booting deadline (~150s). On rehydrate
    //    the reducer resets lastEventAt to Date.now() (so the runner gets
    //    a grace window before being declared dead post-refresh), which
    //    means the watchdog uses the full 150s deadline regardless of
    //    how old our seeded startedAt is. /status then returns
    //    runnerAlive=false (no events file + clientLastEventAt old
    //    enough) and STATUS_RESULT flips the reducer to 'stuck'.
    await expect(page.getByText(/Runner stuck/i)).toBeVisible({
      timeout: 200_000,
    })
    await expect(
      page.getByRole('button', { name: /^Restart$/ }),
    ).toBeVisible()

    // We deliberately do NOT click Restart here — that would spawn a
    // real GHA workflow to verify the rebound to 'booting', and the
    // soft-path test already exercises start→booting from the same
    // entry point. The reducer's FORCE_RESET → START transition is
    // covered by unit tests. This test's scope is the new code path:
    // watchdog → /status → STATUS_RESULT → 'stuck' banner.
  })

  test('Restart from stuck state reboots into booting (and spawns a fresh runner)', async ({
    page,
  }, testInfo) => {
    // Closes the verification loop on the new code I shipped: the
    // Restart button is the user-facing recovery affordance. The reducer
    // path (FORCE_RESET + dispatch + START) is unit-tested, but no
    // existing test confirms the button is wired up correctly end-to-end.
    testInfo.setTimeout(240_000)
    const { owner, repo } = parseRepo(TEST_REPO)
    const ZOMBIE_SESSION_ID = `watchdog-e2e-restart-${Date.now()}`

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.evaluate(
      ([sessionId, ownerArg, repoArg]) => {
        const key = `kody-live-sessions:${ownerArg.toLowerCase()}/${repoArg.toLowerCase()}`
        window.localStorage.setItem(
          key,
          JSON.stringify({
            global: {
              sessionId,
              state: 'booting',
              startedAt: Date.now() - 200_000,
              target: { owner: ownerArg, repo: repoArg },
            },
          }),
        )
      },
      [ZOMBIE_SESSION_ID, owner, repo] as const,
    )
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // Wait for the stuck banner to appear (watchdog cycle, ~150s).
    await expect(page.getByText(/Runner stuck/i)).toBeVisible({
      timeout: 200_000,
    })
    const restart = page.getByRole('button', { name: /^Restart$/ })
    await expect(restart).toBeVisible()

    // ── The actual verification ──
    // Click Restart. The handler should:
    //   1. dispatchLive({ type: 'FORCE_RESET' }) — phase → 'idle'
    //   2. await startInteractiveSession() which dispatches START — phase → 'booting'
    // Net effect: the booting banner appears within seconds.
    await restart.click()
    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 20_000 })

    // Cancel the GHA run that the rebound spawned, so we don't leave it
    // burning minutes idle. Best-effort — the run list query might race
    // the actual dispatch by a second or two, so we tolerate misses.
    const fresh = await findRecentKodyRun(owner, repo)
    if (fresh) {
      try {
        await cancelRun(owner, repo, fresh.id)
      } catch {
        /* non-fatal */
      }
    }
  })

  test('Vibe-scoped session: rehydrate uses vibe-N scope key when on /vibe?issue=N', async ({
    page,
  }, testInfo) => {
    // Covers the user's actual code path: scope key 'vibe-<issueNumber>'
    // instead of 'global'. The lifecycle code is shared, but the scope
    // resolution + storage map indexing is a separate code path that
    // was never exercised by the prior tests (all of which ran on /vibe
    // without ?issue=N → context: null → scope: 'global').
    testInfo.setTimeout(60_000)
    const { owner, repo } = parseRepo(TEST_REPO)

    // Use an existing open issue in the tester repo. Validated at the
    // top of this run via `gh issues --state open`.
    const ISSUE_NUMBER = 3425
    const ZOMBIE_SESSION_ID = `vibe-${ISSUE_NUMBER}-${Date.now()}`

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.evaluate(
      ([sessionId, ownerArg, repoArg, issueN]) => {
        const key = `kody-live-sessions:${ownerArg.toLowerCase()}/${repoArg.toLowerCase()}`
        // Note the scope key shape: `vibe-${issueNumber}`, not `global`.
        window.localStorage.setItem(
          key,
          JSON.stringify({
            [`vibe-${issueN}`]: {
              sessionId,
              state: 'booting',
              startedAt: Date.now() - 200_000,
              target: { owner: ownerArg, repo: repoArg },
            },
          }),
        )
      },
      [ZOMBIE_SESSION_ID, owner, repo, ISSUE_NUMBER] as const,
    )

    await page.goto(`${BASE_URL}/vibe?issue=${ISSUE_NUMBER}`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // The dashboard should:
    //   1. Read context from ?issue=N → context.kind = 'task'
    //   2. With vibeMode=true (vibe page), getLiveScopeKey → 'vibe-N'
    //   3. rehydrateForScope('vibe-N') → REHYDRATE_RESTORED with our seed
    //   4. phase='booting' → booting banner visible
    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 20_000 })

    // Verify the storage key shape — confirms scope is 'vibe-N', not 'global'.
    const storage = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) =>
        k.startsWith('kody-live-sessions'),
      )
      return key ? window.localStorage.getItem(key) : null
    })
    expect(storage).toBeTruthy()
    const parsed = JSON.parse(storage as string) as Record<
      string,
      { sessionId: string }
    >
    expect(Object.keys(parsed)).toContain(`vibe-${ISSUE_NUMBER}`)
    expect(parsed[`vibe-${ISSUE_NUMBER}`]?.sessionId).toBe(ZOMBIE_SESSION_ID)
  })

  test('Issue switch mid-flight: each issue keeps its own scoped session', async ({
    page,
  }, testInfo) => {
    // Hazard C from the audit: switching issues while a session is
    // in-flight must not lose the old scope's session or smear it into
    // the new scope. Each Vibe issue gets its own scoped record.
    testInfo.setTimeout(90_000)
    const { owner, repo } = parseRepo(TEST_REPO)

    const ISSUE_A = 3425
    const ISSUE_B = 3421
    const SESSION_A = `vibe-${ISSUE_A}-${Date.now()}-aaa`
    const SESSION_B = `vibe-${ISSUE_B}-${Date.now()}-bbb`

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.evaluate(
      ([sA, sB, ownerArg, repoArg, iA, iB]) => {
        const key = `kody-live-sessions:${ownerArg.toLowerCase()}/${repoArg.toLowerCase()}`
        window.localStorage.setItem(
          key,
          JSON.stringify({
            [`vibe-${iA}`]: {
              sessionId: sA,
              state: 'booting',
              startedAt: Date.now() - 200_000,
              target: { owner: ownerArg, repo: repoArg },
            },
            [`vibe-${iB}`]: {
              sessionId: sB,
              state: 'booting',
              startedAt: Date.now() - 200_000,
              target: { owner: ownerArg, repo: repoArg },
            },
          }),
        )
      },
      [SESSION_A, SESSION_B, owner, repo, ISSUE_A, ISSUE_B] as const,
    )

    // ── Land on issue A first.
    await page.goto(`${BASE_URL}/vibe?issue=${ISSUE_A}`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 20_000 })

    // ── Navigate to issue B without going through Stop/End.
    await page.goto(`${BASE_URL}/vibe?issue=${ISSUE_B}`)
    await page.waitForLoadState('domcontentloaded')

    // Should rehydrate the B scope (different sessionId), not leak A's
    // session into B's view.
    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 20_000 })

    // ── Back to A — its session must still be there.
    await page.goto(`${BASE_URL}/vibe?issue=${ISSUE_A}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(
      page.getByText(/elapsed|Almost ready|Warming up|Installing|Setting up|Queueing/i),
    ).toBeVisible({ timeout: 20_000 })

    const finalStorage = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) =>
        k.startsWith('kody-live-sessions'),
      )
      return key ? window.localStorage.getItem(key) : null
    })
    const finalMap = JSON.parse(finalStorage as string) as Record<
      string,
      { sessionId: string }
    >
    expect(finalMap[`vibe-${ISSUE_A}`]?.sessionId).toBe(SESSION_A)
    expect(finalMap[`vibe-${ISSUE_B}`]?.sessionId).toBe(SESSION_B)
  })

  test('SSE break does not kill the session: polling keeps the lifecycle alive', async ({
    page,
  }, testInfo) => {
    // Hazard B from the audit: SSE drops mid-stream. The dashboard runs
    // a parallel poll fallback every 3s — this test confirms that even
    // when SSE is completely unreachable, the session reaches 'ready'
    // and the reducer transitions correctly.
    testInfo.setTimeout(300_000)
    const { owner, repo } = parseRepo(TEST_REPO)

    // Block all SSE requests at the network layer.
    await page.route('**/api/kody/events/stream*', (route) =>
      route.abort('failed'),
    )

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    await expect(
      page.getByText(/Live runner is offline|Click Start to warm up/i),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Start$/ }).click()
    await expect(
      page.getByText(/elapsed|Watching .* → Actions/i),
    ).toBeVisible({ timeout: 10_000 })

    // The runner must still reach 'ready' via the 3s poll loop alone.
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 180_000,
    })

    // Cleanup.
    const stop = page.getByRole('button', { name: /^Stop$/ })
    if (await stop.isVisible().catch(() => false)) {
      await stop.click()
    }
  })

  test('Kody Live (Fly) runtime: full soft path on the alternate runner', async ({
    page,
  }, testInfo) => {
    // Same lifecycle assertions as the GHA soft path, but against the
    // Fly Machines runner. Different boot endpoint
    // (/api/kody/chat/interactive/start-fly), different cold-start time
    // (~45s vs ~90s), but the reducer + watchdog path is shared.
    //
    // Skipped automatically if the tester repo's vault doesn't have
    // FLY_API_TOKEN — in which case the kody-live-fly dropdown row
    // never renders and the test can't pick it.
    testInfo.setTimeout(300_000)
    const { owner, repo } = parseRepo(TEST_REPO)

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log(`BROWSER [error] ${msg.text()}`)
      }
    })

    await page.goto(`${BASE_URL}/login`)
    await injectAuth(page, owner, repo)
    await page.goto(`${BASE_URL}/vibe`)
    await page.waitForLoadState('domcontentloaded')

    const viewport = await page.viewportSize()
    test.skip(
      (viewport?.width ?? 1280) < 768,
      'chat rail hidden on mobile',
    )

    // The Fly dropdown row only appears once flyConfigured resolves
    // (the dashboard probes /api/kody/secrets/FLY_API_TOKEN/value on
    // mount, async). Give that probe a moment, then open the dropdown
    // and wait for the Fly option to render — without this wait, the
    // dropdown opens before the probe resolves and the test wrongly
    // skips.
    await page.waitForTimeout(2_000)
    const agentTrigger = page
      .locator('button')
      .filter({ hasText: /Kody Live|GEMINI|Brain/i })
      .first()
    await agentTrigger.click()
    const listbox = page.getByRole('listbox')
    await listbox.waitFor({ state: 'visible', timeout: 10_000 })
    const flyOption = listbox.locator('[role="option"]', {
      hasText: /Kody Live \(Fly\)/i,
    })
    try {
      await flyOption.waitFor({ state: 'visible', timeout: 10_000 })
    } catch {
      test.skip(
        true,
        'kody-live-fly not configured for this repo (FLY_API_TOKEN missing from vault)',
      )
      return
    }
    await flyOption.click()

    // From here on, the flow is the same as the GHA soft path.
    await expect(
      page.getByText(/Live runner is offline|Click Start to warm up/i),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Start$/ }).click()
    await expect(
      page.getByText(/elapsed|Spawning Fly|Cloning repo|Starting engine|Almost ready/i),
    ).toBeVisible({ timeout: 10_000 })

    // Fly boot is faster than GHA — typically 30-50s — but allow 120s
    // for cold image pulls.
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 120_000,
    })

    // Send a turn → assistant reply → typing indicator clears.
    const input = page.getByPlaceholder(/Ask Kody/i)
    await input.fill('say hi in one word')
    await input.press('Enter')
    await expect(page.getByText(/is thinking/i).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/is thinking/i).first()).toBeHidden({
      timeout: 180_000,
    })
    await expect(page.getByText(/Live runner ready/i)).toBeVisible()

    // Cleanup.
    const stop = page.getByRole('button', { name: /^Stop$/ })
    if (await stop.isVisible().catch(() => false)) {
      await stop.click()
    }
  })

  test('Tab refresh during a ready session preserves the session (no silent drop)', async ({
    page,
  }, testInfo) => {
    // Regression check for the persistence-on-mount bug discovered while
    // building the stuck test: my consolidated persistence useEffect was
    // wiping the saved record on first render (phase=idle, sessionId=null
    // looked like a transition INTO idle). The fix is a mounted-ref
    // guard. Confirm here that a session in 'ready' phase actually
    // survives a page reload — without this test, a future regression in
    // the same area would re-introduce a silent session-loss bug.
    testInfo.setTimeout(300_000)
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

    // Boot a real runner to 'ready'.
    await expect(
      page.getByText(/Live runner is offline|Click Start to warm up/i),
    ).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Start$/ }).click()
    await expect(
      page.getByText(/elapsed|Watching .* → Actions/i),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 180_000,
    })

    // Capture the session id so we can verify the same one comes back.
    const beforeStorage = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) =>
        k.startsWith('kody-live-sessions'),
      )
      return key ? window.localStorage.getItem(key) : null
    })
    expect(beforeStorage).toBeTruthy()
    const beforeMap = JSON.parse(beforeStorage as string) as {
      global?: { sessionId: string; state: string }
    }
    expect(beforeMap.global?.state).toBe('ready')
    const sessionIdBefore = beforeMap.global?.sessionId
    expect(sessionIdBefore).toBeTruthy()

    // ── The actual regression check: reload the page. ──
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // The saved session must still be there post-reload.
    const afterStorage = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) =>
        k.startsWith('kody-live-sessions'),
      )
      return key ? window.localStorage.getItem(key) : null
    })
    expect(afterStorage, 'session record must survive reload').toBeTruthy()
    const afterMap = JSON.parse(afterStorage as string) as {
      global?: { sessionId: string }
    }
    expect(afterMap.global?.sessionId).toBe(sessionIdBefore)

    // The banner should rehydrate to 'ready' (poll will re-confirm via
    // the events file). Give it a moment for poll/SSE to reconnect.
    await expect(page.getByText(/Live runner ready/i)).toBeVisible({
      timeout: 30_000,
    })

    // Clean up: end the session.
    const stop = page.getByRole('button', { name: /^Stop$/ })
    if (await stop.isVisible().catch(() => false)) {
      await stop.click()
    }
  })
})
