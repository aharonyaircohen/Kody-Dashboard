/**
 * @fileoverview Render-smoke for the KodyChat component itself, in each mode
 *   it mounts in. After KodyChat.tsx was split into sibling modules
 *   (kody-chat-live-session / -helpers / -types, MessageAttachments,
 *   TypingIndicator), nothing asserted the component still *mounts* — unit
 *   tests cover the extracted logic but not the React render. This is the
 *   cheap "does the composer come up without a crash" guard for:
 *     - global chat rail (dashboard "/")
 *     - Vibe mode (/vibe — locked to kody-live, picker hidden)
 *
 * Runs against a deployed BASE_URL; skips without E2E_GITHUB_TOKEN and on
 * mobile viewports (the rail is hidden there).
 *
 * @testFramework playwright
 * @domain e2e
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  "https://github.com/aharonyaircohen/Kody-Dashboard";

const IGNORED = [
  "Extension context invalidated",
  "chrome-extension",
  "Failed to load resource",
  "Hydration failed",
  "Minified React error #418",
  "502",
  "Bad Gateway",
  "503",
];

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "aharonyaircohen", repo: "Kody-Dashboard" };
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
      user: { login: "e2e-test", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );
}

const MODES = [
  { name: "global chat rail", route: "/" },
  { name: "vibe (locked kody-live)", route: "/vibe" },
] as const;

test.describe("KodyChat — render smoke (post-extraction)", () => {
  for (const mode of MODES) {
    test(`${mode.name} mounts the composer without crashing`, async ({
      page,
    }) => {
      if (!TEST_TOKEN) {
        test.skip(true, "E2E_GITHUB_TOKEN not set");
        return;
      }

      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(`${BASE_URL}/login`);
      await page.waitForLoadState("domcontentloaded");
      await injectAuth(page);

      await page.goto(`${BASE_URL}${mode.route}`);
      await page.waitForLoadState("domcontentloaded");

      const viewport = await page.viewportSize();
      if ((viewport?.width ?? 1280) < 768) {
        test.skip(true, "chat rail hidden on mobile");
        return;
      }

      // The composer textarea is the proof the component rendered.
      const composer = page
        .getByPlaceholder(/ask kody|kody is waiting|message/i)
        .first();
      await expect(composer).toBeVisible({ timeout: 15_000 });

      const critical = errors.filter(
        (e) => !IGNORED.some((i) => e.includes(i)),
      );
      expect(
        critical,
        `${mode.route} console errors:\n${critical.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
