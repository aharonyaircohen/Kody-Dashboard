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

interface CapabilityDetail {
  slug: string;
  describe: string;
  capabilityKind: "observe" | "act" | "verify";
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

interface ManagedGoalRecord {
  id: string;
  path: string;
  updatedAt: string;
  source?: "local" | "store";
  recordType?: "instance" | "template";
  state: {
    version: 1;
    state: "inactive" | "active" | "paused" | "done";
    type: string;
    destination: {
      outcome: string;
      evidence: string[];
    };
    capabilities: string[];
    route: Array<{
      stage: string;
      evidence: string;
      capability: string;
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

function capabilitySeed(
  overrides: Partial<CapabilityDetail> = {},
): CapabilityDetail {
  const slug = overrides.slug ?? "ship-feature";
  return {
    slug,
    describe: "Ship feature",
    capabilityKind: "act",
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

function capabilitySummary(action: CapabilityDetail) {
  return {
    slug: action.slug,
    describe: action.describe,
    capabilityKind: action.capabilityKind,
    landing: action.landing,
    updatedAt: action.updatedAt,
    htmlUrl: action.htmlUrl,
    agent: action.agent,
    source: action.source,
    readOnly: action.readOnly,
  };
}

async function mockCapabilities(page: Page): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const actions = new Map<string, CapabilityDetail>([
    ["ship-feature", capabilitySeed()],
  ]);

  await page.route("**/api/kody/capabilities**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/kody/capabilities", "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method();

    if (parts.length === 0 && method === "GET") {
      await fulfillJson(route, {
        capabilities: Array.from(actions.values()).map(capabilitySummary),
      });
      return;
    }

    if (parts.length === 0 && method === "POST") {
      const body = capture(requests, route, "/api/kody/capabilities") as {
        slug?: string;
        describe?: string;
        instructions?: string;
        capabilityKind?: "observe" | "act" | "verify";
        model?: string;
        permissionMode?: string;
        tools?: string[];
        landing?: "pr" | "comment";
      };
      const created = capabilitySeed({
        slug: body.slug ?? "new-action",
        describe: body.describe ?? "",
        capabilityKind: body.capabilityKind ?? "act",
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
      await fulfillJson(route, { capability: action });
      return;
    }

    if (parts.length === 1 && method === "PATCH" && action) {
      const body = capture(
        requests,
        route,
        `/api/kody/capabilities/${slug}`,
      ) as {
        describe?: string;
        instructions?: string;
        capabilityKind?: "observe" | "act" | "verify";
        model?: string;
        permissionMode?: string;
        tools?: string[];
        landing?: "pr" | "comment";
      };
      actions.set(slug, {
        ...action,
        describe: body.describe ?? action.describe,
        capabilityKind: body.capabilityKind ?? action.capabilityKind,
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
      capture(requests, route, `/api/kody/capabilities/${slug}`);
      actions.delete(slug);
      await fulfillJson(route, { success: true });
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
    recordType: "instance",
    state: {
      version: 1,
      state: "inactive",
      type: "improve",
      destination: {
        outcome: "Improve quality",
        evidence: ["changeVerified"],
      },
      capabilities: ["ship-feature"],
      route: [
        {
          stage: "verify",
          evidence: "changeVerified",
          capability: "ship-feature",
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
      capabilities: ["ship-feature"],
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
    await page
      .getByRole("button", { name: /Build Agent build-agent/ })
      .click();
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

  test("capabilities can be created, updated, and deleted", async ({
    page,
  }) => {
    const requests = await mockCapabilities(page);

    await openPage(page, "/capabilities", "Capabilities");
    await expect(page.getByText("ship-feature").first()).toBeVisible();

    await page.getByRole("link", { name: "New capability" }).click();
    await expect(
      page.getByRole("heading", { name: "New capability", level: 1 }),
    ).toBeVisible();
    await page.getByLabel("Name").fill("Ship hotfix");
    await page
      .getByRole("textbox", { name: "Instructions" })
      .fill("# Instructions\nFix safely.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/kody/capabilities") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    await expect(page.getByText("ship-hotfix").first()).toBeVisible();

    await page.getByText("ship-feature").first().click();
    await page.getByRole("button", { name: "Edit capability" }).click();
    await page
      .getByRole("textbox", { name: "Instructions" })
      .fill("# Instructions\nShip a safer feature.");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/capabilities/ship-feature") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Update" }).click(),
    ]);
    await expect(
      page.getByRole("article").getByText("Ship a safer feature"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete capability" }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(
      deleteDialog.getByRole("heading", {
        name: "Delete capability ship-feature?",
      }),
    ).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/capabilities/ship-feature") &&
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

  test("goals and loops can be run, toggled, and deleted", async ({ page }) => {
    await mockCapabilities(page);
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

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/quality-goal") &&
          response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Deactivate goal" }).click(),
    ]);
    await expect(
      page.getByRole("button", { name: "Activate goal" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Delete goal quality-goal" })
      .click();
    let deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/quality-goal") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: "Remove" }).click(),
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
      .getByRole("button", { name: "Delete loop daily-triage" })
      .click();
    deleteDialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/goals/managed/daily-triage") &&
          response.request().method() === "DELETE",
      ),
      deleteDialog.getByRole("button", { name: "Remove" }).click(),
    ]);
    await expect(page.getByText("daily-triage")).toHaveCount(0);

    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "PATCH",
      "PATCH",
      "DELETE",
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });
});
