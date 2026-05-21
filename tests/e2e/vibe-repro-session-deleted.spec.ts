/**
 * @fileoverview LIVE reproduction harness for the reported vibe bug:
 * "asked chat to create an issue on the default branch; on approving
 * execution the session was completely deleted and nothing happened."
 *
 * Diagnostic, not a clean assertion test. Drives the REAL flow against the
 * deployed dashboard with the REAL configured model (MiniMax — the default),
 * and TEES the /api/kody/chat/kody SSE stream so every tool call + tool
 * output is logged. That output is what tells us whether `vibe_start_execution`
 * returned a switch-agent directive or errored — the difference between a
 * working hand-off and "session deleted, nothing happened".
 *
 * Run: RUN_REAL_E2E=1 with E2E_GITHUB_TOKEN + E2E_GITHUB_REPO + BASE_URL set
 * (all live in .env). Gated off otherwise.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://kody-dashboard-sable.vercel.app";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "", repo: "" };
  }
}

async function injectAuth(page: Page, owner: string, repo: string): Promise<void> {
  await page.evaluate(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: "repro-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

async function snapshotStorage(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("kody-task-chat-") || k === "kody-live-session") {
        const raw = localStorage.getItem(k) ?? "";
        try {
          const parsed = JSON.parse(raw);
          out[k] = Array.isArray(parsed)
            ? { __len: parsed.length, roles: parsed.map((m: { role?: string }) => m.role) }
            : parsed;
        } catch {
          out[k] = raw.slice(0, 120);
        }
      }
    }
    return out;
  });
}

test.describe("Vibe — REPRO: session deleted on approve", () => {
  test.skip(!TEST_TOKEN || !TEST_REPO, "Requires E2E_GITHUB_TOKEN + E2E_GITHUB_REPO.");

  test("create issue → approve execution → session must survive and runner must dispatch", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(900_000);
    const { owner, repo } = parseRepo(TEST_REPO);

    const timeline: string[] = [];
    const log = (s: string) => {
      const line = `[${new Date().toISOString().slice(11, 23)}] ${s}`;
      timeline.push(line);
      // eslint-disable-next-line no-console
      console.log(line);
    };

    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[vibe-debug]") || msg.type() === "error") log(`CONSOLE[${msg.type()}] ${t}`);
    });
    page.on("requestfailed", (req) =>
      log(`REQFAIL ${req.method()} ${new URL(req.url()).pathname} — ${req.failure()?.errorText ?? "?"}`),
    );

    // ── Tee the chat SSE stream so we can read every tool call/output. ──
    // page.request.fetch buffers the full response; we log the parsed SSE
    // events then re-serve the identical body to the page. The chat UI
    // still parses tool calls + runs its post-stream handlers normally.
    let streamCompletions = 0;
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      const turn = streamCompletions + 1;
      // Did this turn carry the current-issue scope to the server? If not,
      // the server can't bind the hand-off to the right issue.
      let reqTask: unknown = null;
      let reqVibe: unknown = undefined;
      try {
        const rb = route.request().postDataJSON() as {
          task?: { issueNumber?: number };
          vibeMode?: boolean;
        };
        reqTask = rb?.task ? { issueNumber: rb.task.issueNumber } : null;
        reqVibe = rb?.vibeMode;
      } catch {
        /* non-JSON */
      }
      log(`STREAM#${turn} start REQ task=${JSON.stringify(reqTask)} vibeMode=${reqVibe}`);
      let resp;
      try {
        resp = await page.request.fetch(route.request(), { timeout: 600_000 });
      } catch (err) {
        log(`STREAM#${turn} fetch error: ${err instanceof Error ? err.message : String(err)}`);
        await route.abort();
        streamCompletions++;
        return;
      }
      const body = await resp.text();
      for (const line of body.split("\n")) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        try {
          const ev = JSON.parse(m[1]) as Record<string, unknown>;
          if (ev.type === "tool-input-available") {
            log(`STREAM#${turn} TOOL-CALL ${ev.toolName} input=${JSON.stringify(ev.input).slice(0, 200)}`);
          } else if (ev.type === "tool-output-available") {
            log(`STREAM#${turn} TOOL-OUT ${JSON.stringify(ev.output).slice(0, 400)}`);
          } else if (ev.type === "error" || ev.errorText) {
            log(`STREAM#${turn} STREAM-ERROR ${JSON.stringify(ev).slice(0, 300)}`);
          }
        } catch {
          /* non-JSON data line */
        }
      }
      log(`STREAM#${turn} end (${body.length} bytes)`);
      streamCompletions++;
      await route.fulfill({
        status: resp.status(),
        headers: resp.headers(),
        body,
      });
    });

    let dispatchCalls = 0; // any runner-dispatch endpoint
    const dispatchEndpoints: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      const p = new URL(req.url()).pathname;
      const isDispatch =
        p.endsWith("/interactive/start") ||
        p.endsWith("/interactive/start-fly") ||
        p.endsWith("/interactive/append") ||
        p.endsWith("/vibe/execute");
      if (isDispatch) {
        dispatchCalls++;
        dispatchEndpoints.push(p);
        log(`DISPATCH ${p} body=${(req.postData() ?? "").slice(0, 160)}`);
      }
    });

    // ── 1. Land on /vibe with auth. ─────────────────────────────────────
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page, owner, repo);
    await page.goto(`${BASE_URL}/vibe`);
    await page.waitForLoadState("domcontentloaded");
    log(`landed on /vibe`);

    const viewport = await page.viewportSize();
    test.skip((viewport?.width ?? 1280) < 768, "chat rail hidden on mobile");

    // ── 2. Select the MiniMax chat model (the user's configured default). ─
    const agentTrigger = page
      .locator("button")
      .filter({ hasText: /Kody Live|Kody Live \(Fly\)|Kody|Brain|MiniMax|GEMINI/i })
      .first();
    await agentTrigger.click();
    const listbox = page.getByRole("listbox");
    await listbox.waitFor({ state: "visible", timeout: 5_000 });
    const miniMax = listbox.locator('[role="option"]').filter({ hasText: /MiniMax/i }).first();
    await expect(miniMax, "MiniMax model option must be present").toBeVisible({ timeout: 5_000 });
    await miniMax.click();
    log(`selected chat agent: MiniMax`);

    // ── 3. Ask it to create an issue (the user's flow). ─────────────────
    const input = page.getByPlaceholder(/ask kody|kody is waiting|ask about/i).first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    // TURN 1 — FORCE issue creation in this turn so we land on ?issue=N
    // BEFORE approving (the user's literal flow). Very directive so the
    // model doesn't defer creation to the approval turn.
    const marker = `repro ${Date.now()}`;
    await input.fill(
      `Call create_enhancement RIGHT NOW to file an issue titled ` +
        `"Update homepage welcome text ${marker}" with a one-line body about ` +
        `changing the welcome text in src/app/(frontend)/page.tsx. Do not research, ` +
        `do not plan, do not ask me anything, do NOT start a runner — just create ` +
        `the issue this turn and then stop.`,
    );
    await input.press("Enter");
    log(`sent TURN 1 (force-create issue) marker=${marker}`);

    // ── 4. Wait for turn 1 stream, then for the ?issue=N navigation. ────
    await expect.poll(() => streamCompletions, { timeout: 300_000, intervals: [2_000] }).toBeGreaterThanOrEqual(1);
    await page
      .waitForURL(/\/vibe\?issue=\d+/, { timeout: 60_000 })
      .catch(() => log("WARN: turn 1 did not navigate to ?issue=N"));
    await page.waitForTimeout(4_000);
    const issueAfterTurn1 = Number.parseInt(
      new URL(page.url()).searchParams.get("issue") ?? "0",
      10,
    );
    const storeAfterT1 = await snapshotStorage(page);
    const bubblesAfterT1 = (await page.locator(".prose").allTextContents().catch(() => [])).length;
    log(`AFTER TURN 1: issue=${issueAfterTurn1} bubbles=${bubblesAfterT1} storage=${JSON.stringify(storeAfterT1)}`);
    await testInfo.attach("after-turn1.png", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    // Diagnostic: poll for up to 25s for the composer to enter task scope
    // (placeholder flips to "Ask about task #N..."). Tells us whether the
    // scope flip is merely slow (timing) or never happens (structural).
    let placeholderAtT2 = "";
    for (let i = 0; i < 13; i++) {
      placeholderAtT2 =
        (await page
          .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
          .first()
          .getAttribute("placeholder")
          .catch(() => "")) ?? "";
      if (/task #\d+/i.test(placeholderAtT2)) break;
      await page.waitForTimeout(2_000);
    }
    log(`composer placeholder before TURN 2 (after polling): "${placeholderAtT2}"`);

    // TURN 2 — approve execution while ALREADY scoped to issue N. THIS is
    // where the user reports the session vanishing and nothing happening.
    const input2 = page.getByPlaceholder(/ask kody|kody is waiting|ask about/i).first();
    await input2.waitFor({ state: "visible", timeout: 30_000 });
    await input2.fill("Approved — implement it now. Do not ask again.");
    await input2.press("Enter");
    log(`sent TURN 2 (approve execution) while scoped to issue ${issueAfterTurn1}`);
    await expect
      .poll(() => streamCompletions, { timeout: 300_000, intervals: [2_000] })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(6_000);
    const bubblesAfterT2 = (await page.locator(".prose").allTextContents().catch(() => [])).length;
    log(`AFTER TURN 2: url=${page.url()} bubbles=${bubblesAfterT2} storage=${JSON.stringify(await snapshotStorage(page))}`);
    await testInfo.attach("after-turn2.png", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    // ── 6. Watch the transfer/navigate/kickoff window for 90s. ──────────
    const deadline = Date.now() + 90_000;
    let lastStore = "";
    while (Date.now() < deadline) {
      const store = JSON.stringify(await snapshotStorage(page));
      if (store !== lastStore) {
        log(`storage Δ: ${store}`);
        lastStore = store;
      }
      if (new URL(page.url()).searchParams.get("issue") && dispatchCalls > 0) break;
      await page.waitForTimeout(2_000);
    }

    // ── 7. Final snapshot + summary. ────────────────────────────────────
    const finalUrl = page.url();
    const issueNumber = Number.parseInt(new URL(finalUrl).searchParams.get("issue") ?? "0", 10);
    const finalStore = await snapshotStorage(page);
    const visibleMessages = await page.locator(".prose").allTextContents().catch(() => []);

    log("──────── SUMMARY ────────");
    log(`finalUrl=${finalUrl}`);
    log(`issueNumber=${issueNumber}`);
    log(`streamCompletions=${streamCompletions}`);
    log(`dispatchCalls=${dispatchCalls} endpoints=${JSON.stringify(dispatchEndpoints)}`);
    log(`final storage=${JSON.stringify(finalStore)}`);
    log(`visible chat bubbles=${visibleMessages.length}`);

    await testInfo.attach("timeline.txt", { body: timeline.join("\n"), contentType: "text/plain" });

    // ── SUCCESS CRITERIA (a failure here == the bug reproduced) ─────────
    expect(issueNumber, "an issue should have been created (URL ?issue=N)").toBeGreaterThan(0);

    // The chat scope key is repo-scoped: `kody-task-chat-<owner>/<repo>:<id>`.
    // Find the conversation under ANY key that ends with the issue number,
    // so we don't false-negative on the scope prefix.
    const convoKey = Object.keys(finalStore).find(
      (k) => k.startsWith("kody-task-chat-") && k.endsWith(`:${issueNumber}`),
    );
    const convoLen =
      (finalStore[convoKey ?? ""] as { __len?: number } | undefined)?.__len ?? 0;
    log(`convoKey=${convoKey ?? "(none)"} convoLen=${convoLen}`);
    expect(
      convoLen,
      `new issue chat scope must hold the transferred conversation — empty/missing = session deleted`,
    ).toBeGreaterThan(0);
    expect(
      dispatchCalls,
      `runner must be dispatched after approval — zero = nothing happened`,
    ).toBeGreaterThan(0);
  });
});
