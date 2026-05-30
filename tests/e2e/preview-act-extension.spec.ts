/**
 * @fileoverview Real end-to-end test of the Kody Preview Inspector
 * extension's `preview_act` flow. Each test owns its own Chromium context
 * with the unpacked extension loaded; the test page is a local HTML
 * fixture exercising the exact bug shapes from the user's reports.
 *
 * Covers:
 *   - `button:has-text("Start Learning")` — Playwright pseudo, English.
 *   - `h3:text-matches("כיתה ט - בסיס")` — Playwright regex pseudo, Hebrew.
 *   - Clicking a card DIV (no role, no button tag) — the closestInteractive
 *     walk-up + full pointer/mouse event sequence fix.
 *   - Filling a controlled-input — native setter path for React.
 *
 * Pattern: per-test launchPersistentContext is the official Playwright
 * recipe for Chrome extensions (Playwright docs > Chrome extensions). The
 * top-level browser fixture from `playwright.config.ts` disables
 * extensions, so we ignore it and drive our own context.
 *
 * Skipped on non-chromium projects (mobile-chrome) because Chrome
 * extensions only run in real Chromium.
 */

import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
} from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import type { AddressInfo } from "node:net";

const EXTENSION_PATH = path.resolve(__dirname, "../../extension");

base.skip(
  ({ browserName }) => browserName !== "chromium",
  "Chrome-extension flow tested only on chromium",
);

interface ExtensionFixture {
  context: BrowserContext;
  fixtureUrl: string;
}

const test = base.extend<ExtensionFixture>({
  context: async ({}, use) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kody-fixture-"));
    const userDataDir = path.join(tmpDir, "user-data");
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await use(ctx);
    await ctx.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  },
  fixtureUrl: async ({}, use) => {
    // The extension's bridge runs in the TOP frame; the picker (and the
    // `act` executor) runs in SUB-FRAMES. Real dashboard hosts a preview
    // iframe — model that exactly. Parent page is just an iframe shell.
    // Tests interact with the parent (which is where window.postMessage
    // talks to the bridge) and read state via iframe.contentWindow.
    const preview = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>preview</title></head>
<body>
  <button id="start" onclick="window.__hits.push('start')">Start Learning</button>

  <div class="card" data-id="hebrew" onclick="window.__hits.push('hebrew')"
       style="cursor:pointer; padding:10px; border:1px solid #ccc">
    <h3>כיתה ט - בסיס</h3>
    <p>Grade 9 - Basics</p>
  </div>

  <div class="card" data-id="grade-card" onclick="window.__hits.push('grade-card')"
       style="cursor:pointer; padding:10px; border:1px solid #ccc">
    <span class="label">Grade 9 - Basics</span>
  </div>

  <input id="email" type="email" placeholder="Email" />

  <script>window.__hits = [];</script>
</body>
</html>`;
    const parent = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>parent</title></head>
<body>
  <h1>Dashboard shell</h1>
  <iframe id="preview" src="/preview" style="width:800px;height:600px"></iframe>
</body>
</html>`;
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.url === "/preview" ? preview : parent);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    await use(`http://127.0.0.1:${port}/`);
    // Force-close any keep-alive sockets first; otherwise server.close()
    // waits for them and the fixture teardown blows the test timeout.
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },
});

async function sendAct(
  page: import("@playwright/test").Page,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(
    ({ payload }) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const requestId = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        const handler = (event: MessageEvent) => {
          const d = event.data as
            | undefined
            | {
                source?: string;
                type?: string;
                requestId?: string;
                ok?: boolean;
                error?: string;
              };
          if (!d || d.source !== "kody-picker:ext") return;
          if (d.type !== "act-result") return;
          if (d.requestId !== requestId) return;
          window.removeEventListener("message", handler);
          resolve({ ok: Boolean(d.ok), error: d.error });
        };
        window.addEventListener("message", handler);
        window.postMessage(
          {
            source: "kody-picker:page",
            type: "act",
            payload,
            requestId,
          },
          window.location.origin,
        );
        setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve({ ok: false, error: "no act-result in 5s" });
        }, 5000);
      }),
    { payload },
  );
}

test.describe.configure({ mode: "serial" });

test.describe("Kody Preview Inspector — preview_act in a real browser", () => {
  // Read state from inside the preview iframe — that's where the
  // interactive elements (and the picker logic) actually live.
  async function previewHits(
    page: import("@playwright/test").Page,
  ): Promise<string[]> {
    return page.evaluate(() => {
      const fr = document.querySelector("iframe") as HTMLIFrameElement | null;
      const w = fr?.contentWindow as unknown as { __hits?: string[] } | null;
      return w?.__hits ?? [];
    });
  }

  async function previewInputValue(
    page: import("@playwright/test").Page,
    selector: string,
  ): Promise<string | null> {
    return page.evaluate((sel) => {
      const fr = document.querySelector("iframe") as HTMLIFrameElement | null;
      const doc = fr?.contentDocument;
      const inp = doc?.querySelector(sel) as HTMLInputElement | null;
      return inp ? inp.value : null;
    }, selector);
  }

  async function bootAndWaitForExtension(
    context: BrowserContext,
    fixtureUrl: string,
  ): Promise<import("@playwright/test").Page> {
    const page = await context.newPage();
    await page.goto(fixtureUrl);
    // Bridge stamps the data attribute in the top frame. Wait for it so
    // we know the extension is ready before posting any "act".
    await page.waitForFunction(
      () => document.documentElement.dataset.kodyPicker !== undefined,
      null,
      { timeout: 10_000 },
    );
    // Also wait for the iframe to load — the picker in the sub-frame
    // needs to have initialised before it can handle `act` broadcasts.
    await page.waitForFunction(
      () => {
        const fr = document.querySelector("iframe") as HTMLIFrameElement | null;
        return Boolean(fr?.contentDocument?.body);
      },
      null,
      { timeout: 10_000 },
    );
    return page;
  }

  test("clicks a native <button> via :has-text", async ({
    context,
    fixtureUrl,
  }) => {
    const page = await bootAndWaitForExtension(context, fixtureUrl);
    await sendAct(page, {
      op: "click",
      selector: 'button:has-text("Start Learning")',
    });
    await expect.poll(() => previewHits(page), { timeout: 4000 }).toContain(
      "start",
    );
  });

  test("clicks a card <div> by its Hebrew <h3> child via :text-matches", async ({
    context,
    fixtureUrl,
  }) => {
    const page = await bootAndWaitForExtension(context, fixtureUrl);
    const result = await sendAct(page, {
      op: "click",
      selector: 'h3:text-matches("כיתה ט - בסיס")',
    });
    expect(result.ok, `act failed: ${result.error}`).toBe(true);
    // The h3 has no click handler; the card div above it does. The full
    // mouse-event sequence must bubble so the card's onclick fires.
    await expect
      .poll(() => previewHits(page), { timeout: 4000 })
      .toContain("hebrew");
  });

  test("clicks a plain card <div> by its inner label (no role, no button tag)", async ({
    context,
    fixtureUrl,
  }) => {
    const page = await bootAndWaitForExtension(context, fixtureUrl);
    await sendAct(page, {
      op: "click",
      selector: ':has-text("Grade 9 - Basics")',
    });
    // Either card may match — both contain "Grade 9 - Basics" as visible text.
    await expect
      .poll(() => previewHits(page), { timeout: 4000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^(grade-card|hebrew)$/)]));
  });

  test("fills an <input> via #id (React controlled-input safe setter)", async ({
    context,
    fixtureUrl,
  }) => {
    const page = await bootAndWaitForExtension(context, fixtureUrl);
    await sendAct(page, { op: "fill", selector: "#email", value: "a@b.com" });
    await expect
      .poll(() => previewInputValue(page, "#email"), { timeout: 4000 })
      .toBe("a@b.com");
  });
});
