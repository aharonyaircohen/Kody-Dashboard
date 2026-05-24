/**
 * @fileoverview Live verification of the warm-pool path through the DEPLOYED
 *   dashboard. Proves that the production dashboard (on Vercel) can reach the
 *   pool owner (kody pool-serve on kody-litellm.fly.dev) and read live pool
 *   counts — the network path that the Vibe-execute claim depends on.
 * @testFramework playwright
 * @domain e2e
 *
 * Run against the deployed URL:
 *   BASE_URL=https://kody-dashboard-aguy.vercel.app pnpm test:e2e pool-live
 *
 * Requires E2E_GITHUB_TOKEN + E2E_GITHUB_REPO (loaded from .env by the config).
 */
import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ??
  "https://github.com/aharonyaircohen/Kody-Engine-Tester";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "aharonyaircohen", repo: "Kody-Engine-Tester" };
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

test.describe("warm pool — live through deployed dashboard", () => {
  test.skip(!TEST_TOKEN, "E2E_GITHUB_TOKEN not set");

  test("dashboard reaches the pool owner and reports live counts", async ({
    page,
  }) => {
    // Authenticate (localStorage is origin-scoped → set after first nav).
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);

    // Call the pool-status API THROUGH the deployed app, with the same auth
    // headers the dashboard client sends. A real count proves Vercel → pool.
    const { owner, repo } = parseRepo(TEST_REPO);
    const result = await page.evaluate(
      async ({ token, owner, repo }) => {
        const res = await fetch("/api/kody/pool/status", {
          headers: {
            "x-kody-token": token,
            "x-kody-owner": owner,
            "x-kody-repo": repo,
          },
        });
        return { status: res.status, body: await res.text() };
      },
      { token: TEST_TOKEN, owner, repo },
    );

    console.log(
      "[pool-live] /api/kody/pool/status →",
      result.status,
      result.body,
    );
    expect(result.status).toBe(200);
    const json = JSON.parse(result.body) as {
      status: { min: number; free: number; total: number } | null;
    };
    // The pool owner is reachable and returned real counts (not null).
    expect(json.status).not.toBeNull();
    expect(typeof json.status?.free).toBe("number");
    expect(json.status?.min).toBeGreaterThan(0);
  });

  test("Settings renders the LiteLLM card with the warm-pool line", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");

    // Best-effort visual proof. The card only renders when the connected repo
    // has FLY_API_TOKEN in its vault; capture a screenshot regardless.
    await page.screenshot({
      path: "test-results/pool-settings.png",
      fullPage: true,
    });
    const litellm = page.getByText("LiteLLM proxy", { exact: false });
    if (await litellm.count()) {
      await expect(page.getByText(/Warm pool/i)).toBeVisible({
        timeout: 15_000,
      });
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "LiteLLM card not shown — repo vault has no FLY_API_TOKEN; API check covers reachability.",
      });
    }
  });
});
