/**
 * @fileoverview Render-smoke for every top-level dashboard page.
 * @testFramework playwright
 * @domain e2e
 *
 * The deep e2e suite is concentrated on chat + vibe; whole feature pages
 * (Activity, Inbox, Duties, Staff, Secrets, Notifications, Models, Prompts,
 * Reports, Settings, Runner, …) had no "does it even mount" guard. This
 * parametrized smoke visits each authenticated route and asserts the page
 * renders without a crash or a critical console error — the cheapest broad
 * safety net against a page-level regression (bad import, render throw,
 * provider crash).
 *
 * Runs against a deployed BASE_URL; skips when E2E_GITHUB_TOKEN is absent
 * (same gate as dashboard-smoke).
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  "https://github.com/aharonyaircohen/Kody-Dashboard";

// Static top-level routes. Dynamic ([issueNumber]) and /*/docs pages are
// excluded — they need live data or are static content, covered elsewhere.
const ROUTES = [
  "/",
  "/activity",
  "/changelog",
  "/chat",
  "/duties",
  "/inbox",
  "/instructions",
  "/messages",
  "/models",
  "/new",
  "/notifications",
  "/commands",
  "/reports",
  "/repos",
  "/runner",
  "/scenario",
  "/secrets",
  "/settings",
  "/staff",
  "/variables",
  "/vibe",
] as const;

// Noise we never want to fail a render-smoke on (extensions, transient
// network, hydration mismatch, upstream 5xx from a cold backend).
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
      user: {
        login: "e2e-test",
        avatar_url: "https://github.com/github-mark.png",
        id: 1,
      },
      loggedInAt: Date.now(),
    },
  );
}

test.describe("Top-level pages — render smoke", () => {
  for (const route of ROUTES) {
    test(`${route} renders without crashing`, async ({ page }) => {
      if (!TEST_TOKEN) {
        test.skip(true, "E2E_GITHUB_TOKEN not set");
        return;
      }

      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));

      // localStorage is origin-scoped — seed auth on the origin first.
      await page.goto(`${BASE_URL}/login`);
      await page.waitForLoadState("domcontentloaded");
      await injectAuth(page);

      const response = await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1_000);

      // The document itself must not be a hard error page.
      if (response) {
        expect(
          response.status(),
          `${route} returned HTTP ${response.status()}`,
        ).toBeLessThan(500);
      }

      // The shell mounted.
      await expect(page.locator("body")).toBeVisible();

      const critical = errors.filter((e) => !IGNORED.some((i) => e.includes(i)));
      expect(
        critical,
        `${route} console errors:\n${critical.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
