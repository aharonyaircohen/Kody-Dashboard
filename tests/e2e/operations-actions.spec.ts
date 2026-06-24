/**
 * @fileoverview Operations action browser tests.
 * @testFramework playwright
 * @domain e2e
 *
 * Exercises the real Dashboard Operations UI with mocked GitHub-backed APIs so
 * create/update/run/toggle/delete flows are verified without mutating a repo.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const NOW = "2026-06-22T10:00:00.000Z";

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

interface Agent {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
  htmlUrl: string;
  source?: "local" | "store";
  readOnly?: boolean;
}

interface AgentActionDetail {
  slug: string;
  describe: string;
  landing: "pr" | "comment";
  updatedAt: string;
  htmlUrl: string;
  agent: string | null;
  source?: "local" | "store";
  readOnly?: boolean;
  prompt: string;
  model: string;
  permissionMode: string;
  tools: string[];
  skills: Array<{ name: string; content: string }>;
  shellScripts: Array<{ name: string; content: string }>;
  mcpServers: Array<{ name: string; command: string; args?: string[] }>;
  profileJson: string;
}

interface AgentResponsibility {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
  htmlUrl: string;
  source?: "local" | "store";
  readOnly?: boolean;
  lastTickAt: string | null;
  nextEligibleAt: string | null;
  lastOutcome: string | null;
  lastDurationMs: number | null;
  schedule: string | null;
  capabilityKind: "observe" | "act" | "verify" | null;
  disabled: boolean;
  agent: string | null;
  reviewer: string | null;
  action: string;
  mentions: string[];
  agentAction: string | null;
  agentActions: string[];
  agentResponsibilityTools: string[];
  tickScript: string | null;
  readsFrom: string[];
  writesTo: string[];
}

interface ManagedGoalRecord {
  id: string;
  path: string;
  updatedAt: string;
  source?: "local" | "store";
  state: {
    version: 1;
    state: "inactive" | "active" | "paused" | "done";
    type: string;
    destination: {
      outcome: string;
      evidence: string[];
    };
    agentResponsibilities: string[];
    route: Array<{
      stage: string;
      evidence: string;
      agentResponsibility: string;
      agentAction: string;
    }>;
    schedule: "manual" | "1h" | "1d" | "7d" | "30d";
    stage: string;
    facts: Record<string, unknown>;
    blockers: string[];
    scheduleMode?: "agentLoop";
    instances?: Array<{
      id: string;
      state: "inactive" | "active" | "paused" | "done";
      facts: Record<string, unknown>;
      blockers: string[];
      createdAt?: string;
      updatedAt?: string;
    }>;
  };
}

type CapturedRequest = {
  method: string;
  path: string;
  body: unknown;
};

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
}

async function mockIdentity(page: Page): Promise<void> {
  await page.route("**/api/kody/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          login: "e2e-test",
          avatar_url: "https://github.com/github-mark.png",
          githubId: 1,
        },
        owner: "acme",
        repo: "widgets",
      }),
    });
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function routeBody(route: Route): unknown {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function capture(
  requests: CapturedRequest[],
  route: Route,
  path: string,
): unknown {
  const body = routeBody(route);
  requests.push({ method: route.request().method(), path, body });
  return body;
}

async function openPage(
  page: Page,
  path: string,
  heading: string | RegExp,
): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 10_000,
  });
}

function agentSeed(overrides: Partial<Agent> = {}): Agent {
  const slug = overrides.slug ?? "atlas";
  return {
    slug,
    title: "Atlas Agent",
    body: "Coordinates product delivery.",
    updatedAt: NOW,
    htmlUrl: `https://example.test/${slug}.md`,
    source: "local",
    ...overrides,
  };
}

async function mockAgents(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const agents: Agent[] = [agentSeed()];

  await page.route("**/api/kody/agents**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/kody/agents", "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method();

    if (parts.length === 0 && method === "GET") {
      await fulfillJson(route, { agent: agents });
      return;
    }

    if (parts.length === 0 && method === "POST") {
      const body = capture(requests, route, "/api/kody/agents") as {
        slug?: string;
        title?: string;
        body?: string;
      };
      const created = agentSeed({
        slug: body.slug || slugify(body.title ?? "new-agent"),
        title: body.title ?? "New Agent",
        body: body.body ?? "",
      });
      agents.push(created);
      await fulfillJson(route, { agentMember: created });
      return;
    }

    const slug = parts[0];
    const index = agents.findIndex((agent) => agent.slug === slug);

    if (parts.length === 1 && method === "GET" && index >= 0) {
      await fulfillJson(route, { agentMember: agents[index] });
      return;
    }

    if (parts.length === 1 && method === "PATCH" && index >= 0) {
      const body = capture(requests, route, `/api/kody/agents/${slug}`) as {
        title?: string;
        body?: string;
      };
      agents[index] = {
        ...agents[index],
        title: body.title ?? agents[index].title,
        body: body.body ?? agents[index].body,
        updatedAt: NOW,
      };
      await fulfillJson(route, { agentMember: agents[index] });
      return;
    }

    if (parts.length === 1 && method === "DELETE" && index >= 0) {
      capture(requests, route, `/api/kody/agents/${slug}`);
      agents.splice(index, 1);
      await fulfillJson(route, { success: true });
      return;
    }

    if (parts.length === 2 && parts[1] === "dispatch" && method === "POST") {
      capture(requests, route, `/api/kody/agents/${slug}/dispatch`);
      await fulfillJson(route, {
        issueNumber: 123,
        commentId: 456,
        commentUrl: "https://example.test/comment",
      });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });

  return requests;
}

function actionSeed(
  overrides: Partial<AgentActionDetail> = {},
): AgentActionDetail {
  const slug = overrides.slug ?? "ship-feature";
  return {
    slug,
    describe: "Ship feature",
    landing: "pr",
    updatedAt: NOW,
    htmlUrl: `https://example.test/${slug}`,
    agent: null,
    source: "local",
    prompt: "Implement the feature safely.",
    model: "inherit",
    permissionMode: "acceptEdits",
    tools: ["Read"],
    skills: [],
    shellScripts: [],
    mcpServers: [],
    profileJson: "{}",
    ...overrides,
  };
}

function actionSummary(action: AgentActionDetail) {
  return {
    slug: action.slug,
    describe: action.describe,
    landing: action.landing,
    updatedAt: action.updatedAt,
    htmlUrl: action.htmlUrl,
    agent: action.agent,
    source: action.source,
    readOnly: action.readOnly,
  };
}

async function mockAgentActions(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const actions = new Map<string, AgentActionDetail>([
    ["ship-feature", actionSeed()],
  ]);

  await page.route("**/api/kody/agent-actions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/kody/agent-actions", "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method();

    if (parts.length === 0 && method === "GET") {
      await fulfillJson(route, {
        agentActions: Array.from(actions.values()).map(actionSummary),
      });
      return;
    }

    if (parts.length === 0 && method === "POST") {
      const body = capture(requests, route, "/api/kody/agent-actions") as {
        slug?: string;
        describe?: string;
        instructions?: string;
        model?: string;
        permissionMode?: string;
        tools?: string[];
        landing?: "pr" | "comment";
      };
      const created = actionSeed({
        slug: body.slug ?? "new-action",
        describe: body.describe ?? "",
        prompt: body.instructions ?? "",
        model: body.model ?? "inherit",
        permissionMode: body.permissionMode ?? "acceptEdits",
        tools: body.tools ?? [],
        landing: body.landing ?? "pr",
      });
      actions.set(created.slug, created);
      await fulfillJson(route, { success: true });
      return;
    }

    const slug = parts[0];
    const action = actions.get(slug);

    if (parts.length === 1 && method === "GET" && action) {
      await fulfillJson(route, { agentAction: action });
      return;
    }

    if (parts.length === 1 && method === "PATCH" && action) {
      const body = capture(
        requests,
        route,
        `/api/kody/agent-actions/${slug}`,
      ) as {
        describe?: string;
        instructions?: string;
        model?: string;
        permissionMode?: string;
        tools?: string[];
        landing?: "pr" | "comment";
      };
      actions.set(slug, {
        ...action,
        describe: body.describe ?? action.describe,
        prompt: body.instructions ?? action.prompt,
        model: body.model ?? action.model,
        permissionMode: body.permissionMode ?? action.permissionMode,
        tools: body.tools ?? action.tools,
        landing: body.landing ?? action.landing,
        updatedAt: NOW,
      });
      await fulfillJson(route, { success: true });
      return;
    }

    if (parts.length === 1 && method === "DELETE" && action) {
      capture(requests, route, `/api/kody/agent-actions/${slug}`);
      actions.delete(slug);
      await fulfillJson(route, { success: true });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });

  return requests;
}

function responsibilitySeed(
  overrides: Partial<AgentResponsibility> = {},
): AgentResponsibility {
  const slug = overrides.slug ?? "release-watch";
  return {
    slug,
    title: "Release Watch",
    body: "Watch release work.",
    updatedAt: NOW,
    htmlUrl: `https://example.test/${slug}`,
    source: "local",
    readOnly: false,
    lastTickAt: null,
    nextEligibleAt: null,
    lastOutcome: null,
    lastDurationMs: null,
    schedule: "manual",
    capabilityKind: "act",
    disabled: false,
    agent: "atlas",
    reviewer: null,
    action: "release-watch",
    mentions: [],
    agentAction: "ship-feature",
    agentActions: [],
    agentResponsibilityTools: [],
    tickScript: null,
    readsFrom: [],
    writesTo: [],
    ...overrides,
  };
}

async function mockResponsibilities(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const responsibilities: AgentResponsibility[] = [responsibilitySeed()];

  await page.route("**/api/kody/agent-responsibilities**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/kody/agent-responsibilities", "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method();

    if (parts.length === 0 && method === "GET") {
      await fulfillJson(route, { agentResponsibilities: responsibilities });
      return;
    }

    if (parts.length === 0 && method === "POST") {
      const body = capture(
        requests,
        route,
        "/api/kody/agent-responsibilities",
      ) as Partial<AgentResponsibility> & { title?: string; body?: string };
      const created = responsibilitySeed({
        slug: body.slug ?? slugify(body.title ?? "new-responsibility"),
        title: body.title ?? "New Responsibility",
        body: body.body ?? "",
        schedule: body.schedule ?? "manual",
        capabilityKind: body.capabilityKind ?? "observe",
        disabled: body.disabled ?? false,
        agent: body.agent ?? null,
        reviewer: body.reviewer ?? null,
        action: body.action ?? "",
        agentAction: body.agentAction ?? null,
      });
      responsibilities.push(created);
      await fulfillJson(route, { agentResponsibility: created });
      return;
    }

    const slug = parts[0];
    const index = responsibilities.findIndex((item) => item.slug === slug);

    if (parts.length === 1 && method === "PATCH" && index >= 0) {
      const body = capture(
        requests,
        route,
        `/api/kody/agent-responsibilities/${slug}`,
      ) as Partial<AgentResponsibility>;
      responsibilities[index] = {
        ...responsibilities[index],
        ...body,
        updatedAt: NOW,
      };
      await fulfillJson(route, {
        agentResponsibility: responsibilities[index],
      });
      return;
    }

    if (parts.length === 1 && method === "DELETE" && index >= 0) {
      capture(requests, route, `/api/kody/agent-responsibilities/${slug}`);
      responsibilities.splice(index, 1);
      await fulfillJson(route, { success: true });
      return;
    }

    if (parts.length === 2 && parts[1] === "run" && method === "POST") {
      capture(requests, route, `/api/kody/agent-responsibilities/${slug}/run`);
      await fulfillJson(route, {
        workflowId: "wf",
        ref: "main",
        action: responsibilities[index]?.action ?? slug,
        agentResponsibility: slug,
        force: true,
      });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });

  return requests;
}

function managedGoalSeed(
  overrides: Partial<ManagedGoalRecord> = {},
): ManagedGoalRecord {
  const id = overrides.id ?? "quality-goal";
  const state = overrides.state;
  return {
    id,
    path: `goals/instances/${id}/state.json`,
    updatedAt: NOW,
    source: "local",
    state: {
      version: 1,
      state: "inactive",
      type: "improve",
      destination: {
        outcome: "Improve quality",
        evidence: ["changeVerified"],
      },
      agentResponsibilities: ["release-watch"],
      route: [
        {
          stage: "verify",
          evidence: "changeVerified",
          agentResponsibility: "release-watch",
          agentAction: "ship-feature",
        },
      ],
      schedule: "manual",
      stage: "verify",
      facts: {},
      blockers: [],
      instances: [],
      ...state,
    },
    ...overrides,
  };
}

function managedLoopSeed(): ManagedGoalRecord {
  return managedGoalSeed({
    id: "daily-triage",
    path: "goals/instances/daily-triage/state.json",
    state: {
      version: 1,
      state: "active",
      type: "agentLoop",
      destination: {
        outcome: "Keep triage moving",
        evidence: [],
      },
      agentResponsibilities: ["release-watch"],
      route: [],
      schedule: "1d",
      stage: "triage",
      facts: {},
      blockers: [],
      scheduleMode: "agentLoop",
      instances: [],
    },
  });
}

async function mockManagedGoals(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const goals = new Map<string, ManagedGoalRecord>([
    ["quality-goal", managedGoalSeed()],
    ["daily-triage", managedLoopSeed()],
  ]);

  await page.route("**/api/kody/goals/managed**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/kody/goals/managed", "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method();

    if (parts.length === 0 && method === "GET") {
      await fulfillJson(route, { goals: Array.from(goals.values()) });
      return;
    }

    const id = parts[0];
    const goal = goals.get(id);

    if (parts.length === 1 && method === "PATCH" && goal) {
      const body = capture(
        requests,
        route,
        `/api/kody/goals/managed/${id}`,
      ) as { state?: ManagedGoalRecord["state"]["state"] };
      const updated = {
        ...goal,
        state: {
          ...goal.state,
          ...(body.state ? { state: body.state } : {}),
        },
        updatedAt: NOW,
      };
      goals.set(id, updated);
      await fulfillJson(route, { goal: updated });
      return;
    }

    if (parts.length === 1 && method === "DELETE" && goal) {
      capture(requests, route, `/api/kody/goals/managed/${id}`);
      goals.delete(id);
      await fulfillJson(route, { success: true });
      return;
    }

    if (parts.length === 2 && parts[1] === "run" && method === "POST" && goal) {
      capture(requests, route, `/api/kody/goals/managed/${id}/run`);
      await fulfillJson(route, {
        ok: true,
        workflowId: "wf",
        ref: "main",
        goal,
      });
      return;
    }

    await route.fulfill({ status: 404, body: "{}" });
  });

  return requests;
}

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockIdentity(page);
});

test.describe("Operations actions", () => {
  test("agents can be created, edited, dispatched, and deleted", async ({
    page,
  }) => {
    const requests = await mockAgents(page);

    await page.goto("/agents", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Atlas Agent").first()).toBeVisible();

    await page.getByRole("button", { name: "New member" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: "New agent" }),
    ).toBeVisible();
    await createDialog.getByLabel("Title").fill("Build Agent");
    await createDialog.locator("textarea").last().fill("Coordinates builds.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agents") &&
          response.request().method() === "POST",
      ),
      createDialog.getByRole("button", { name: "Create member" }).click(),
    ]);
    await expect(
      page.getByRole("heading", { name: "Build Agent" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit agent" }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Title").fill("Build Agent Updated");
    await editDialog
      .locator("textarea")
      .last()
      .fill("Coordinates safer builds.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agents/build-agent") &&
          response.request().method() === "PATCH",
      ),
      editDialog.getByRole("button", { name: "Save changes" }).click(),
    ]);
    await expect(
      page.getByRole("heading", { name: "Build Agent Updated" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Send task" }).click();
    const sendDialog = page.getByRole("dialog");
    await sendDialog.locator("textarea").last().fill("Check the release plan.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agents/build-agent/dispatch") &&
          response.request().method() === "POST",
      ),
      sendDialog.getByRole("button", { name: "Send task" }).click(),
    ]);

    await page.getByRole("button", { name: "Delete agent" }).click();
    const deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agents/build-agent") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: /^Delete/ }).click(),
    ]);
    await expect(page.getByText("Build Agent Updated")).toHaveCount(0);

    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "DELETE",
    ]);
  });

  test("agent actions can be created, updated, and deleted", async ({
    page,
  }) => {
    const requests = await mockAgentActions(page);

    await openPage(page, "/agent-actions", "Actions");
    await expect(page.getByText("ship-feature").first()).toBeVisible();

    await page.getByRole("link", { name: /new agentaction/i }).click();
    await expect(
      page.getByRole("heading", { name: "New action" }),
    ).toBeVisible();
    await page.getByLabel("Implementation slug").fill("ship-hotfix");
    await page.getByLabel("Description").fill("Ship a hotfix");
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.locator("textarea").last().fill("# Instructions\nFix safely.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/kody/agent-actions") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create" }).click(),
    ]);
    await expect(page.getByText("ship-hotfix").first()).toBeVisible();

    await page.getByText("ship-feature").first().click();
    await page.getByRole("button", { name: "Edit agentAction" }).click();
    await page.getByLabel("Description").fill("Ship a safer feature");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agent-actions/ship-feature") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Update" }).click(),
    ]);
    await expect(
      page.getByRole("article").getByText("Ship a safer feature"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete agentAction" }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(
      deleteDialog.getByRole("heading", {
        name: "Delete agentAction ship-feature?",
      }),
    ).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/agent-actions/ship-feature") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: "Delete" }).click(),
    ]);
    await expect(page.getByText("ship-feature")).toHaveCount(0);

    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });

  test("responsibilities can be created, run, disabled, enabled, and deleted", async ({
    page,
  }) => {
    await mockAgents(page);
    await mockAgentActions(page);
    const requests = await mockResponsibilities(page);

    await openPage(page, "/agent-responsibilities", "Responsibilities");
    await expect(page.getByText("Release Watch").first()).toBeVisible();

    await page.getByRole("button", { name: "New agentResponsibility" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("Title").fill("Nightly QA");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/kody/agent-responsibilities") &&
          response.request().method() === "POST",
      ),
      createDialog
        .getByRole("button", { name: "Create agentResponsibility" })
        .click(),
    ]);
    await expect(page.getByText("Nightly QA").first()).toBeVisible();

    await page
      .locator("button")
      .filter({ hasText: "release-watch" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Release Watch" }),
    ).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/api/kody/agent-responsibilities/release-watch/run") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Run agentResponsibility now" }).click(),
    ]);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/api/kody/agent-responsibilities/release-watch") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Disable agentResponsibility" }).click(),
    ]);

    await page.getByRole("button", { name: "Disabled" }).click();
    await page
      .locator("button")
      .filter({ hasText: "release-watch" })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Enable agentResponsibility" }),
    ).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/api/kody/agent-responsibilities/release-watch") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Enable agentResponsibility" }).click(),
    ]);

    await page.getByRole("button", { name: "Enabled" }).click();
    await page
      .locator("button")
      .filter({ hasText: "release-watch" })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Disable agentResponsibility" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Delete agentResponsibility" })
      .click();
    const deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/api/kody/agent-responsibilities/release-watch") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog
        .getByRole("button", { name: "Delete agentResponsibility" })
        .click(),
    ]);
    await expect(page.getByText("Release Watch")).toHaveCount(0);

    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "POST",
      "PATCH",
      "PATCH",
      "DELETE",
    ]);
  });

  test("goals and loops can be run, toggled, and deleted", async ({ page }) => {
    await mockResponsibilities(page);
    const requests = await mockManagedGoals(page);

    await openPage(page, "/agent-goals", "Goals");
    await expect(page.getByText("quality-goal").first()).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/quality-goal/run") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Run goal now" }).click(),
    ]);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/quality-goal") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Activate goal" }).click(),
    ]);
    await expect(
      page.getByRole("button", { name: "Deactivate goal" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Delete goal", exact: true })
      .click();
    let deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/quality-goal") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: "Delete" }).click(),
    ]);
    await expect(page.getByText("quality-goal")).toHaveCount(0);

    await openPage(page, "/agent-loops", "Loops");
    await expect(page.getByText("daily-triage").first()).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/daily-triage/run") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Run loop now" }).click(),
    ]);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/daily-triage") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Deactivate loop" }).click(),
    ]);
    await expect(
      page.getByRole("button", { name: "Activate loop" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Delete loop", exact: true })
      .click();
    deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/daily-triage") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: "Delete" }).click(),
    ]);
    await expect(page.getByText("daily-triage")).toHaveCount(0);

    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "PATCH",
      "DELETE",
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });
});
