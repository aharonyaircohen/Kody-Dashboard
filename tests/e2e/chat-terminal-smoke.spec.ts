/**
 * @fileoverview Smoke coverage for KodyChat terminal mode.
 * @testFramework playwright
 * @domain terminal
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
  "Encountered a script tag while rendering React component",
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

async function openTerminal(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await injectAuth(page);

  const { owner, repo } = parseRepo(TEST_REPO);
  await page.goto(`${BASE_URL}/repo/${owner}/${repo}`);
  await page.waitForLoadState("domcontentloaded");

  const viewport = await page.viewportSize();
  if ((viewport?.width ?? 1280) < 768) {
    test.skip(true, "chat rail hidden on mobile");
    return;
  }

  const composer = page.locator("textarea:not(.xterm-helper-textarea)");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  const terminalButton = page.getByRole("button", { name: /Terminal/ });
  await expect(terminalButton).toHaveCount(1);
  await terminalButton.first().click();

  await expect(page.getByLabel("Terminal target")).toBeVisible({
    timeout: 10_000,
  });
}

async function visibleTerminalText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".xterm"))
      .filter((terminal) => {
        const element = terminal as HTMLElement;
        return Boolean(
          element.offsetWidth ||
          element.offsetHeight ||
          element.getClientRects().length,
        );
      })
      .map((terminal) =>
        Array.from(terminal.querySelectorAll(".xterm-rows div"))
          .map((row) => row.textContent ?? "")
          .join("\n"),
      )
      .join("\n"),
  );
}

test.describe("KodyChat terminal mode smoke", () => {
  test("can switch into terminal mode and back to AI chat", async ({
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

    await openTerminal(page);
    await expect(
      page.getByRole("button", { name: "Add terminal output to AI chat" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "AI chat", exact: true }).click();
    const composer = page.locator("textarea:not(.xterm-helper-textarea)");
    await expect(composer).toBeVisible({ timeout: 10_000 });

    const critical = errors.filter((e) => !IGNORED.some((i) => e.includes(i)));
    expect(
      critical,
      `chat terminal console errors:\n${critical.join("\n")}`,
    ).toHaveLength(0);
  });

  test("scrolls terminal history with the mouse wheel", async ({ page }) => {
    if (!TEST_TOKEN) {
      test.skip(true, "E2E_GITHUB_TOKEN not set");
      return;
    }

    await openTerminal(page);
    const terminal = page.locator(".xterm").last();
    await expect(terminal).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => visibleTerminalText(page), {
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .not.toHaveLength(0);

    const scrollMarkers = Array.from(
      { length: 90 },
      (_, index) => `KODY_SCROLL_${index + 1}`,
    );
    const composer = page.locator("textarea:not(.xterm-helper-textarea)");
    await composer.fill(`printf '%s\\n' ${scrollMarkers.join(" ")}`);
    await composer.press("Enter");

    await expect
      .poll(() => visibleTerminalText(page), {
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .toContain("KODY_SCROLL_90");

    const box = await terminal.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -1200);

    await expect
      .poll(() => visibleTerminalText(page), {
        timeout: 10_000,
        intervals: [250, 500],
      })
      .toContain("KODY_SCROLL_40");
  });
});
