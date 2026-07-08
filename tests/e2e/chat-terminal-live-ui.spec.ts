/**
 * @fileoverview Live browser verifier for the Brain terminal UI.
 * @testFramework playwright
 * @domain terminal-live
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const TEST_TOKEN =
  process.env.KODY_LIVE_GITHUB_TOKEN ??
  process.env.E2E_GITHUB_TOKEN ??
  process.env.GITHUB_TOKEN ??
  process.env.KODY_BOT_TOKEN ??
  process.env.GH_TOKEN ??
  "";
const REPO_SLUG =
  process.env.KODY_LIVE_REPO_SLUG ??
  process.env.KODY_REPO_SLUG ??
  slugFromUrl(process.env.KODY_LIVE_REPO_URL) ??
  slugFromUrl(process.env.E2E_GITHUB_REPO) ??
  "";
const STORE_REPO_URL = process.env.KODY_LIVE_STORE_REPO_URL;
const STORE_REF = process.env.KODY_LIVE_STORE_REF;
const USER_LOGIN = process.env.KODY_LIVE_USER_LOGIN ?? "e2e-terminal";
const WAIT_MS = Number(process.env.KODY_LIVE_UI_WAIT_MS ?? 75_000);

test.setTimeout(Math.max(180_000, WAIT_MS + 120_000));

function slugFromUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/github\.com[:/]+([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function parseSlug(slug: string): { owner: string; repo: string } | null {
  const [owner, repo] = slug.split("/");
  return owner && repo ? { owner, repo } : null;
}

async function installAuth(contextPage: Page, owner: string, repo: string) {
  await contextPage.context().addInitScript(
    (auth) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
    },
    {
      repoUrl: `https://github.com/${owner}/${repo}`,
      owner,
      repo,
      token: TEST_TOKEN,
      user: { login: USER_LOGIN, avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
      ...(STORE_REPO_URL ? { storeRepoUrl: STORE_REPO_URL } : {}),
      ...(STORE_REF ? { storeRef: STORE_REF } : {}),
    },
  );
}

async function visibleTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      return Boolean(
        html.offsetWidth || html.offsetHeight || html.getClientRects().length,
      );
    };
    return Array.from(document.querySelectorAll(".xterm"))
      .filter(isVisible)
      .map((terminal) =>
        Array.from(terminal.querySelectorAll(".xterm-rows div"))
          .map((row) => row.textContent ?? "")
          .join("\n"),
      )
      .join("\n");
  });
}

async function waitForTerminalText(page: Page, text: string, timeout = 45_000) {
  await expect
    .poll(() => visibleTerminalText(page), { timeout, intervals: [500, 1000] })
    .toContain(text);
}

async function typeCommand(page: Page, command: string) {
  await page.locator(".xterm").last().click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function selectVisibleTerminalText(page: Page, text: string) {
  const selected = await page.locator(".xterm").last().evaluate((terminal, value) => {
    const rows = Array.from(terminal.querySelectorAll(".xterm-rows div"));
    const targetRow = rows.find((row) => (row.textContent ?? "").includes(value));
    if (!targetRow) return "";
    const selection = window.getSelection();
    if (!selection) return "";
    const walker = document.createTreeWalker(targetRow, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = (node.textContent ?? "").indexOf(value);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + value.length);
        selection.removeAllRanges();
        selection.addRange(range);
        targetRow.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        document.dispatchEvent(new Event("selectionchange"));
        return selection.toString();
      }
      node = walker.nextNode();
    }
    return "";
  }, text);
  expect(selected).toContain(text);
}

test.describe("Brain terminal live UI", () => {
  test("selects Brain, keeps xterm visible, and accepts input after the stall window", async ({
    page,
  }) => {
    const repo = parseSlug(REPO_SLUG);
    if (!TEST_TOKEN || !repo) {
      test.skip(
        true,
        "Set KODY_LIVE_GITHUB_TOKEN and KODY_LIVE_REPO_SLUG=owner/repo",
      );
      return;
    }

    const terminalSessionResponses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/kody/terminal/session")) {
        terminalSessionResponses.push(response.status());
      }
    });

    await installAuth(page, repo.owner, repo.repo);
    await page.goto(`${BASE_URL}/repo/${repo.owner}/${repo.repo}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: /Terminal/ }).first().click();
    const target = page.getByLabel("Terminal target");
    await expect(target).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () =>
          target.locator("option").evaluateAll((options) =>
            options.map((option) => ({
              value: (option as HTMLOptionElement).value,
              text: option.textContent ?? "",
            })),
          ),
        { timeout: 60_000, intervals: [1000, 2500] },
      )
      .toContainEqual(expect.objectContaining({ value: "brain" }));

    await target.selectOption("brain");
    await expect
      .poll(() => documentBodyText(page), {
        timeout: 120_000,
        intervals: [1000, 2500],
      })
      .toContain("Brain terminal · connected");

    expect(terminalSessionResponses).toContain(200);
    await expect.poll(() => visibleTerminalText(page)).not.toHaveLength(0);

    const firstMarker = `KODY_UI_FIRST_${Date.now()}`;
    await typeCommand(page, `printf "${firstMarker}\\n"`);
    await waitForTerminalText(page, firstMarker);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Terminal/ }).first().click();
    const restoredTarget = page.getByLabel("Terminal target");
    await expect(restoredTarget).toBeVisible({ timeout: 20_000 });
    await restoredTarget.selectOption("brain");
    await expect
      .poll(() => documentBodyText(page), {
        timeout: 120_000,
        intervals: [1000, 2500],
      })
      .toContain("Brain terminal · connected");

    const restoredMarker = `KODY_UI_RESTORED_${Date.now()}`;
    await typeCommand(page, `printf "${restoredMarker}\\n"`);
    await waitForTerminalText(page, restoredMarker);

    await selectVisibleTerminalText(page, restoredMarker);
    await expect(page.getByRole("button", { name: "Copy selection" })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Copy selection" }).click();

    await page.waitForTimeout(WAIT_MS);
    await expect
      .poll(() => documentBodyText(page), { timeout: 15_000 })
      .toContain("Brain terminal · connected");
    await expect.poll(() => visibleTerminalText(page)).not.toHaveLength(0);

    const secondMarker = `KODY_UI_SECOND_${Date.now()}`;
    await typeCommand(page, `printf "${secondMarker}\\n"`);
    await waitForTerminalText(page, secondMarker);
  });
});

async function documentBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}
