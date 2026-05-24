/**
 * @fileoverview Browser-side IDB + multimodal attachments e2e for the
 * Kody direct agent. Mocks /api/kody/chat/kody to capture the outgoing
 * payload (asserting we send proper image parts, not base64-stuffed
 * text), then reloads the page to verify the message + thumbnail
 * survive via IndexedDB.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3399";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "ghp_placeholder";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/test-owner/test-repo";

// 1×1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_BUFFER = Buffer.from(PNG_BASE64, "base64");

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "test-owner", repo: parts[1] ?? "test-repo" };
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
      user: { login: "idb-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

async function selectKodyAgent(page: Page): Promise<void> {
  const trigger = page
    .locator("button")
    .filter({ hasText: /Kody(\s|$)|Brain/ })
    .first();
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ state: "visible", timeout: 5_000 });
  await listbox.getByRole("option", { name: /^Kody\b/ }).click();
}

/** Read the count of records in the IDB attachment store from the page. */
async function idbCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("kody-attachments", 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("attachments")) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction("attachments", "readonly");
          const store = tx.objectStore("attachments");
          const cnt = store.count();
          cnt.onsuccess = () => {
            resolve(cnt.result);
            db.close();
          };
          cnt.onerror = () => {
            reject(cnt.error);
            db.close();
          };
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

test.describe("Kody direct — IDB persistence + multimodal", () => {
  test.beforeEach(async ({ page }) => {
    // Start clean so prior runs don't contaminate IDB or localStorage.
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      localStorage.clear();
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("kody-attachments");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    });
    await injectAuth(page);
    // The in-process "Kody" agent only appears when a model is configured;
    // mock the model list (labelled "Kody …" so selectKodyAgent's /^Kody\b/
    // option selector matches). Persists across the in-test reload.
    await page.route("**/api/kody/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "test/model", label: "Kody Test", enabled: true }],
        }),
      }),
    );
  });

  test("uploads image, sends multimodal payload, persists across reload via IDB", async ({
    page,
  }) => {
    // Capture the outgoing /api/kody/chat/kody body and reply with a
    // simple text stream. We *don't* rely on the model here — we want to
    // verify the client wire shape.
    let captured: unknown = null;
    await page.route("**/api/kody/chat/kody", async (route, req) => {
      try {
        captured = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"text-delta","delta":"I see your image."}\n\n' +
          "data: [DONE]\n\n",
      });
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    await selectKodyAgent(page);

    // Upload the PNG via the (hidden) file input.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: PNG_BUFFER,
    });

    // Type and send a question about the image.
    const input = page.getByPlaceholder(/ask kody|kody is waiting/i).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("what is this?");
    await input.press("Enter");

    // Reply rendered → request completed.
    await expect(
      page.getByText("I see your image.").first(),
    ).toBeVisible({ timeout: 15_000 });

    // 1) The outgoing payload must use structured parts, not a base64
    // string smashed into the text. Last user message → content array
    // → has a text part AND an image part with a data URL.
    expect(captured, "request body").not.toBeNull();
    const body = captured as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const lastUser = [...body.messages]
      .reverse()
      .find((m) => m.role === "user");
    expect(lastUser, "last user msg").toBeTruthy();
    expect(Array.isArray(lastUser!.content), "content is parts[]").toBe(true);
    const parts = lastUser!.content as Array<{
      type: string;
      text?: string;
      image?: string;
      mimeType?: string;
    }>;
    const textPart = parts.find((p) => p.type === "text");
    const imagePart = parts.find((p) => p.type === "image");
    expect(textPart?.text).toBe("what is this?");
    expect(imagePart, "image part present").toBeTruthy();
    expect(imagePart!.image).toMatch(/^data:image\/png;base64,/);
    expect(imagePart!.mimeType).toBe("image/png");

    // 2) Blob must now live in IDB.
    expect(await idbCount(page), "idb has 1 blob").toBe(1);

    // useChatSessions debounces its localStorage write by 1s — wait for
    // the message to actually land in the store before we reload, or
    // post-reload hydration finds nothing.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            // The sessions store is repo-scoped (kody-sessions-v3:owner/repo),
            // so scan every key with that prefix and sum message counts.
            let total = 0;
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k || !k.startsWith("kody-sessions-v3")) continue;
              try {
                const parsed = JSON.parse(localStorage.getItem(k) ?? "{}") as {
                  messages?: Record<string, Array<{ text?: string }>>;
                };
                total += Object.values(parsed.messages ?? {}).reduce(
                  (n, arr) => n + arr.length,
                  0,
                );
              } catch {
                /* ignore malformed */
              }
            }
            return total;
          }),
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThanOrEqual(2);

    // 3) Hard reload — the message + thumbnail must come back.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await selectKodyAgent(page);

    // User message text still rendered.
    await expect(
      page.getByText("what is this?", { exact: false }).first(),
    ).toBeVisible({
      timeout: 10_000,
    });

    // Assistant reply still rendered (message memory across reload).
    await expect(
      page.getByText("I see your image.", { exact: false }).first(),
    ).toBeVisible({
      timeout: 10_000,
    });

    // Thumbnail <img> with a data: src appears, hydrated from IDB.
    const thumb = page.locator('img[alt="pixel.png"]').first();
    await expect(thumb).toBeVisible({ timeout: 10_000 });
    const src = await thumb.getAttribute("src");
    expect(src ?? "").toMatch(/^data:image\/png;base64,/);

    // IDB still has exactly one blob — no orphan added on reload.
    expect(await idbCount(page), "idb still has 1 blob after reload").toBe(1);
  });
});
