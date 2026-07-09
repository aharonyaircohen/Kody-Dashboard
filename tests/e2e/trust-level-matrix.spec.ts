import { expect, test, type Page, type Route } from "@playwright/test";

type TrustLevel = "approval-required" | "can-run" | "auto-approval";
type TrustStats = {
  approvals: number;
  rejections: number;
  consecutiveApprovals: number;
  mode: "ask" | "auto";
  level: TrustLevel;
};
type TrustPayload = {
  capability?: string;
  subject?: string;
  level?: TrustLevel;
};

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const NOW = "2026-07-09T09:00:00.000Z";
const cycleLevels: TrustLevel[] = [
  "can-run",
  "auto-approval",
  "approval-required",
];
const labels: Record<TrustLevel, string> = {
  "approval-required": "Require approval",
  "can-run": "Kody can run",
  "auto-approval": "Auto approval",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function seedAuth(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/acme/widgets",
        owner: "acme",
        repo: "widgets",
        token: "ghp_placeholder",
        user: { login: "e2e-test", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.setItem("kody:chat-first-layout", "0");
  });
}

function statsForLevel(level: TrustLevel): TrustStats {
  const canRun = level !== "approval-required";
  return {
    approvals: 0,
    rejections: 0,
    consecutiveApprovals: canRun ? 10 : 0,
    mode: canRun ? "auto" : "ask",
    level,
  };
}

async function mockDashboardApis(page: Page) {
  const subjects: Record<string, TrustStats> = {};
  const capabilities: Record<string, TrustStats> = {};
  const trustPosts: TrustPayload[] = [];

  await page.route("**/api/kody/auth/me", (route) =>
    fulfillJson(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
      owner: "acme",
      repo: "widgets",
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    fulfillJson(route, {
      models: [{ id: "gpt-x", label: "GPT X", enabled: true }],
    }),
  );
  await page.route("**/api/kody/commands", (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route("**/api/kody/tasks*", (route) =>
    fulfillJson(route, { tasks: [], items: [] }),
  );
  await page.route("**/api/kody/config*", (route) =>
    fulfillJson(route, { config: {} }),
  );

  await page.route("**/api/kody/goals/managed/*/runs*", (route) =>
    fulfillJson(route, { runs: [] }),
  );
  await page.route("**/api/kody/goals/managed", (route) =>
    fulfillJson(route, {
      goals: [
        workflowBackedGoal("web-release"),
        managedGoal("daily-web-release-loop", "agentLoop", "1d"),
      ],
    }),
  );
  await page.route("**/api/kody/company/workflows", (route) =>
    fulfillJson(route, {
      workflows: [
        {
          id: "web-release",
          path: "workflows/web-release/workflow.json",
          source: "local",
          runnable: true,
          htmlUrl:
            "https://github.com/acme/widgets/blob/main/workflows/web-release/workflow.json",
          workflow: {
            version: 1,
            name: "Web release",
            capabilities: ["release-prepare"],
            createdAt: NOW,
            updatedAt: NOW,
          },
          updatedAt: NOW,
        },
      ],
    }),
  );
  await page.route("**/api/kody/capabilities/release-prepare", (route) =>
    fulfillJson(route, { capability: capabilityDetail() }),
  );
  await page.route("**/api/kody/capabilities", (route) =>
    fulfillJson(route, { capabilities: [capabilitySummary()] }),
  );
  await page.route("**/api/kody/cto/trust", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { capabilities, subjects, log: [] });
      return;
    }

    const body = (await route.request().postDataJSON()) as TrustPayload;
    trustPosts.push(body);
    const level = body.level ?? "approval-required";
    const stats = statsForLevel(level);
    if (body.subject) subjects[body.subject] = stats;
    if (body.capability) {
      const subject = `capability:${body.capability}`;
      subjects[subject] = stats;
      capabilities[body.capability] = statsForLevel(
        level === "auto-approval" ? "auto-approval" : "approval-required",
      );
    }
    await fulfillJson(route, {
      ok: true,
      ...(body.subject ? { subject: body.subject } : {}),
      ...(body.capability ? { capability: body.capability } : {}),
      level,
      stats,
    });
  });

  return { trustPosts };
}

function managedGoal(
  id: string,
  type: "agentGoal" | "agentLoop",
  schedule: "manual" | "1d",
) {
  return {
    id,
    path: `todos/${id}.json`,
    updatedAt: NOW,
    source: "local",
    recordType: "instance",
    state: {
      version: 1,
      state: type === "agentLoop" ? "active" : "inactive",
      type: type === "agentLoop" ? "agentLoop" : "improve",
      destination: {
        outcome: id,
        evidence: type === "agentLoop" ? [] : ["releaseReady"],
      },
      capabilities: ["release-prepare"],
      route:
        type === "agentLoop"
          ? []
          : [
              {
                stage: "prepare",
                evidence: "releaseReady",
                capability: "release-prepare",
              },
            ],
      schedule,
      stage: "dispatch",
      facts: {},
      blockers: [],
      ...(type === "agentLoop"
        ? {
            scheduleMode: "agentLoop",
            preferredRunTime: { at: "02:00", timezone: "Asia/Jerusalem" },
          }
        : {}),
      instances: [],
    },
  };
}

function capabilitySummary() {
  return {
    slug: "release-prepare",
    describe: "Prepare web release",
    landing: { title: "Release Prepare", summary: "Prepare web release" },
    updatedAt: NOW,
    htmlUrl:
      "https://github.com/acme/widgets/blob/main/capabilities/release-prepare/profile.json",
    agent: "release-agent",
    source: "local",
    readOnly: false,
  };
}

function capabilityDetail() {
  return {
    ...capabilitySummary(),
    prompt: "Prepare release notes and checks.",
    model: "inherit",
    permissionMode: "default",
    tools: ["Read", "Edit", "Bash"],
    skills: [],
    shellScripts: [],
    mcpServers: [],
    profileJson: "{}",
  };
}

function workflowBackedGoal(id: string) {
  return {
    ...managedGoal(id, "agentGoal", "manual"),
    state: {
      ...managedGoal(id, "agentGoal", "manual").state,
      type: "web-release",
      templateId: "web-release",
      sourceTemplate: "web-release",
      workflowRef: { source: "store", id: "web-release" },
      capabilities: [],
      route: [],
      stage: "workflow",
      destination: {
        outcome: "Release is prepared and verified on production.",
        evidence: [
          "releasePrExists",
          "defaultBranchMerged",
          "releasePromotionPrExists",
          "releaseBranchMerged",
          "productionDeployed",
        ],
      },
    },
  };
}

test.describe("runnable trust levels", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
  });

  const trustedCases = [
    {
      name: "goal",
      path: "/agent-goals/web-release",
      expected: { subject: "goal:web-release" },
    },
    {
      name: "workflow",
      path: "/workflows/web-release",
      expected: { subject: "workflow:web-release" },
    },
  ] as const;

  for (const item of trustedCases) {
    test(`${item.name} detail lets the user select every trust level`, async ({
      page,
    }) => {
      const { trustPosts } = await mockDashboardApis(page);
      await page.goto(`${BASE_URL}${item.path}`, {
        waitUntil: "domcontentloaded",
      });

      for (const level of cycleLevels) {
        const button = page.getByRole("button", { name: /Trust level:/ });
        await expect(button).toBeVisible({ timeout: 15_000 });
        await button.click();
        await expect(
          page.getByRole("button", {
            name: `Trust level: ${labels[level]}`,
          }),
        ).toHaveAttribute("data-trust-level", level);
        expect(trustPosts.at(-1)).toMatchObject({
          ...item.expected,
          level,
        });
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", {
          name: `Trust level: ${labels["approval-required"]}`,
        }),
      ).toHaveAttribute("data-trust-level", "approval-required");
    });
  }

  test("loop detail has auto-run but no trust level control", async ({
    page,
  }) => {
    await mockDashboardApis(page);
    await page.goto(`${BASE_URL}/agent-loops/daily-web-release-loop`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("button", { name: "Disable loop auto-run" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /Trust level:/ }),
    ).toHaveCount(0);
  });

  test("workflow-backed goal detail shows workflow instead of empty capabilities", async ({
    page,
  }) => {
    await mockDashboardApis(page);
    await page.goto(`${BASE_URL}/agent-goals/web-release`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "web-release" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Workflow" }),
    ).toBeVisible();
    await expect(page.getByText("Web release", { exact: true })).toBeVisible();
    await expect(page.getByText("release-prepare").first()).toBeVisible();
    await expect(
      page.getByText("No capabilities are attached to this goal."),
    ).toHaveCount(0);
  });

  test("capability detail has no trust level control", async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto(`${BASE_URL}/capabilities/release-prepare`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "release-prepare" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /Trust level:/ }),
    ).toHaveCount(0);
  });
});
