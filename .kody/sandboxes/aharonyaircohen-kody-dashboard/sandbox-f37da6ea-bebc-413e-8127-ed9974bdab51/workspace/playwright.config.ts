import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

// Load .env so local runs pick up E2E_GITHUB_TOKEN / E2E_GITHUB_REPO /
// RUN_REAL_E2E / BASE_URL etc. without requiring `source .env`. CI sets
// these via repo secrets and won't find a .env file — that's fine.
loadDotenv({ path: ".env", override: false });

/**
 * Playwright E2E test configuration.
 *
 * Usage:
 *   BASE_URL=https://my-app.vercel.app pnpm test:e2e
 *
 * In CI (GitHub Actions):
 *   Vercel deploys a preview → URL captured → passed as BASE_URL → tests run
 */
export default defineConfig({
  testDir: "./tests/e2e",

  /* Run tests in parallel — safe since each test uses a fresh context */
  fullyParallel: false, // Disabled: parallel workers can cause "Access denied" on localStorage in some Playwright versions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  /* Reporter — GitHub Actions annotate failures inline */
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"]],

  /* Shared setup: inject auth cookie if KODY_BOT_TOKEN is available */
  webServer: undefined, // Preview URLs are already live — no local server needed

  use: {
    /* Target URL — set via BASE_URL env var */
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3333",

    /* Capture trace on first retry for debugging */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on failure */
    video: "retain-on-failure",
  },

  /* Browser variants */
  projects: [
    /* Chromium — primary browser for testing */
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /* Disable HTTPS upgrade for localhost — needed for local dev against HTTP server */
        launchOptions: {
          args: [
            "--host-rules=MAP localhost 127.0.0.1",
            "--disable-extensions",
          ],
        },
        /* Use the bot token cookie for auth — enables real dashboard interactions */
        extraHTTPHeaders: {
          /* Pass bot token so API routes accept requests without OAuth session */
          ...(process.env.KODY_BOT_TOKEN
            ? { Authorization: `Bearer ${process.env.KODY_BOT_TOKEN}` }
            : {}),
        },
      },
    },

    /* Mobile Safari — verify responsive layout */
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],

  /* Timeout conventions */
  timeout: 60_000,
});
