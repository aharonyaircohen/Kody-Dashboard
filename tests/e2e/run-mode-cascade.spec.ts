/**
 * @fileoverview Browser proof for workflow/goal/loop Run Mode.
 * @testFramework playwright
 * @domain e2e
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const NOW = "2026-07-03T00:00:00.000Z";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: {
    login: "e2e-test",
    avatar_url: "https://github.com/github-mark.png",
    id: 1,
  },
  loggedInAt: Date.now(),
};

type TrustPost = {
  capability: string;
  op: "graduate" | "degrade" | "reset";
};

type RunPost = {
  path: string;
};

const expectedCapabilities = ["ci-health", "qa-review"];

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockIdentity(page: Page): Promise<void> {
  await page.route("**/api/kody/auth/me", async (route) => {
    await fulfillJson(route, {
      authenticated: true,
      user: {
        login: "e2e-test",
        avatar_url: "https://github.com/github-mark.png",
        githubId: 1,
      },
      owner: "acme",
      repo: "widgets",
    });
  });
}

async function mockCapabilities(page: Page): Promise<void> {
  await page.route("**/api/kody/capabilities**", async (route) => {
    await fulfillJson(route, {
      capabilities: expectedCapabilities.map((slug) => ({
        slug,
        describe: slug,
        agent: slug,
        updatedAt: NOW,
        htmlUrl: `https://example.test/${slug}`,
      })),
    });
  });
}

async function mockWorkflows(page: Page, runs: RunPost[]): Promise<void> {
  const workflow = {
    id: "release-workflow",
    path: "workflows/release-workflow/workflow.json",
    runnable: true,
    source: "local",
    workflow: {
      version: 1,
      name: "Release Workflow",
      capabilities: expectedCapabilities,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };

  await page.route("**/api/kody/company/workflows**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/kody/company/workflows" && method === "GET") {
      await fulfillJson(route, { workflows: [workflow] });
      return;
    }

    if (
      url.pathname === "/api/kody/company/workflows/release-workflow/run" &&
      method === "POST"
    ) {
      runs.push({ path: url.pathname });
      await fulfillJson(route, {
        ok: true,
        workflowId: "release-workflow",
        ref: "main",
        workflow: "kody.yml",
        action: "release-workflow",
      });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });
}

async function mockManagedGoals(page: Page, runs: RunPost[]): Promise<void> {
  const qualityGoal = {
    id: "quality-goal",
    path: "todos/quality-goal.json",
    updatedAt: NOW,
    source: "local",
    recordType: "instance",
    state: {
      version: 1,
      state: "active",
      type: "improve",
      destination: {
        outcome: "Keep quality green",
        evidence: ["ciGreen"],
      },
      capabilities: ["ci-health"],
      route: [
        {
          stage: "review",
          evidence: "ciGreen",
          capability: "qa-review",
        },
      ],
      schedule: "manual",
      stage: "review",
      facts: {},
      blockers: [],
    },
  };

  const dailyLoop = {
    id: "daily-triage",
    path: "todos/daily-triage.json",
    updatedAt: NOW,
    source: "local",
    recordType: "instance",
    state: {
      version: 1,
      state: "active",
      type: "agentLoop",
      destination: {
        outcome: "Run the release workflow every day",
        evidence: [],
      },
      capabilities: [],
      route: [],
      schedule: "1d",
      stage: "loop",
      facts: {},
      blockers: [],
      scheduleMode: "agentLoop",
      loopTarget: { type: "goal", id: "web-release" },
      scheduleState: {
        mode: "agentLoop",
        lastGoalTickAt: NOW,
        lastDecision: {
          kind: "dispatch",
          targetType: "goal",
          targetId: "web-release",
          capability: "release-prepare",
          reason: "ready target loop tick",
          at: NOW,
        },
        capabilities: Object.fromEntries(
          expectedCapabilities.map((slug) => [
            slug,
            {
              slug,
              state: "waiting",
              reason: "waiting",
            },
          ]),
        ),
      },
      instances: [],
    },
  };

  await page.route("**/api/kody/goals/managed**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/kody/goals/managed" && method === "GET") {
      await fulfillJson(route, { goals: [qualityGoal, dailyLoop] });
      return;
    }

    if (
      url.pathname === "/api/kody/goals/managed/quality-goal/run" &&
      method === "POST"
    ) {
      runs.push({ path: url.pathname });
      await fulfillJson(route, {
        ok: true,
        workflowId: "wf",
        ref: "main",
        goal: qualityGoal,
      });
      return;
    }

    if (
      url.pathname === "/api/kody/goals/managed/daily-triage/run" &&
      method === "POST"
    ) {
      runs.push({ path: url.pathname });
      await fulfillJson(route, {
        ok: true,
        workflowId: "wf",
        ref: "main",
        goal: dailyLoop,
      });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });
}

async function mockTrust(page: Page, posts: TrustPost[]): Promise<void> {
  const modes = new Map<string, "ask" | "auto">();

  await page.route("**/api/kody/cto/trust", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      const capabilities = Object.fromEntries(
        expectedCapabilities.map((capability) => [
          capability,
          {
            approvals: 0,
            rejections: 0,
            consecutiveApprovals: 0,
            mode: modes.get(capability) ?? "ask",
          },
        ]),
      );
      await fulfillJson(route, { capabilities, log: [] });
      return;
    }

    if (request.method() === "POST") {
      const body = request.postDataJSON() as TrustPost;
      posts.push({ capability: body.capability, op: body.op });
      modes.set(body.capability, body.op === "graduate" ? "auto" : "ask");
      await fulfillJson(route, {
        ok: true,
        capability: body.capability,
        op: body.op,
        stats: {
          approvals: 0,
          rejections: 0,
          consecutiveApprovals: 0,
          mode: modes.get(body.capability) ?? "ask",
        },
      });
      return;
    }

    await route.fulfill({ status: 405, body: "{}" });
  });
}

async function installMocks(
  page: Page,
  trustPosts: TrustPost[],
  runPosts: RunPost[],
): Promise<void> {
  await seedAuth(page);
  await mockIdentity(page);
  await mockCapabilities(page);
  await mockTrust(page, trustPosts);
  await mockWorkflows(page, runPosts);
  await mockManagedGoals(page, runPosts);
}

async function openItemPage(
  page: Page,
  path: string,
  heading: string,
): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 10_000,
  });
  const runMode = page.getByRole("group", { name: "Run Mode" });
  await expect(runMode.getByRole("button", { name: "Auto" })).toBeVisible();
  await expect(runMode.getByRole("button", { name: "Manual" })).toBeVisible();
  await expect(runMode.getByRole("button", { name: "Auto" })).toHaveText("");
  await expect(runMode.getByRole("button", { name: "Manual" })).toHaveText("");
}

async function clickModeAndExpectTrust(
  page: Page,
  trustPosts: TrustPost[],
  mode: "Auto" | "Manual",
): Promise<void> {
  const start = trustPosts.length;
  const op: TrustPost["op"] = mode === "Auto" ? "graduate" : "degrade";
  await page.getByRole("button", { name: mode, exact: true }).click();
  await expect
    .poll(() => trustPosts.length, { timeout: 10_000 })
    .toBe(start + expectedCapabilities.length);
  const runMode = page.getByRole("group", { name: "Run Mode" });
  await expect(runMode.getByRole("button", { name: mode })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(trustPosts.slice(start).sort(compareTrustPosts)).toEqual(
    expectedCapabilities
      .map((capability) => ({ capability, op }))
      .sort(compareTrustPosts),
  );
}

async function clickRunAndExpectCascade(
  page: Page,
  trustPosts: TrustPost[],
  runPosts: RunPost[],
  runButtonName: string | RegExp,
  runPath: string,
): Promise<void> {
  const trustStart = trustPosts.length;
  const runStart = runPosts.length;

  await page.getByRole("button", { name: runButtonName }).click();

  await expect
    .poll(() => trustPosts.length, { timeout: 10_000 })
    .toBe(trustStart + expectedCapabilities.length);
  await expect
    .poll(() => runPosts.length, { timeout: 10_000 })
    .toBe(runStart + 1);

  expect(trustPosts.slice(trustStart).sort(compareTrustPosts)).toEqual(
    expectedCapabilities
      .map((capability) => ({ capability, op: "graduate" as const }))
      .sort(compareTrustPosts),
  );
  expect(runPosts.at(-1)).toEqual({ path: runPath });
}

function compareTrustPosts(a: TrustPost, b: TrustPost): number {
  return `${a.capability}:${a.op}`.localeCompare(`${b.capability}:${b.op}`);
}

test.describe("Run Mode cascade", () => {
  test("workflow, goal, and loop pages expose icon-only Auto / Manual controls and cascade to capabilities before run", async ({
    page,
  }) => {
    const trustPosts: TrustPost[] = [];
    const runPosts: RunPost[] = [];
    await installMocks(page, trustPosts, runPosts);

    await openItemPage(page, "/workflows/release-workflow", "Release Workflow");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickModeAndExpectTrust(page, trustPosts, "Manual");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickRunAndExpectCascade(
      page,
      trustPosts,
      runPosts,
      /Run workflow release-workflow/,
      "/api/kody/company/workflows/release-workflow/run",
    );

    await openItemPage(page, "/agent-goals/quality-goal", "quality-goal");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickModeAndExpectTrust(page, trustPosts, "Manual");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickRunAndExpectCascade(
      page,
      trustPosts,
      runPosts,
      "Run goal now",
      "/api/kody/goals/managed/quality-goal/run",
    );

    await openItemPage(page, "/agent-loops/daily-triage", "daily-triage");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickModeAndExpectTrust(page, trustPosts, "Manual");
    await clickModeAndExpectTrust(page, trustPosts, "Auto");
    await clickRunAndExpectCascade(
      page,
      trustPosts,
      runPosts,
      "Run loop now",
      "/api/kody/goals/managed/daily-triage/run",
    );
  });
});
