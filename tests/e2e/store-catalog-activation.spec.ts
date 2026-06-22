/**
 * @fileoverview Store Catalog import browser tests.
 * @testFramework playwright
 * @domain e2e
 *
 * Runs the real catalog UI with mocked catalog/import APIs so the browser flow
 * verifies that "Import to repo" imports models, not just config references.
 */
import { expect, test, type Page } from "@playwright/test";

type CatalogKind =
  | "agent"
  | "agentAction"
  | "agentResponsibility"
  | "agentGoal"
  | "agentLoop";

interface CatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogKind;
  status: "not-active" | "customized";
  active: boolean;
  activatable: boolean;
  source: "store" | "local";
  htmlUrl: string | null;
  action?: string | null;
  agent?: string | null;
  agentAction?: string | null;
  capabilityKind?: string | null;
  schedule?: string | null;
}

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

const catalogSeeds: Array<Omit<CatalogItem, "active" | "status" | "source">> = [
  {
    slug: "atlas-agent",
    title: "Atlas Agent",
    description: "Coordinates product delivery.",
    kind: "agent",
    activatable: true,
    htmlUrl: null,
  },
  {
    slug: "ship-feature",
    title: "Ship Feature",
    description: "Implements a requested feature.",
    kind: "agentAction",
    activatable: true,
    htmlUrl: null,
  },
  {
    slug: "release-watch",
    title: "Release Watch",
    description: "Keeps release work moving.",
    kind: "agentResponsibility",
    activatable: true,
    htmlUrl: null,
    agent: "atlas-agent",
    agentAction: "ship-feature",
    capabilityKind: "act",
  },
  {
    slug: "weekly-quality",
    title: "Weekly Quality",
    description: "Maintains quality goals.",
    kind: "agentGoal",
    activatable: true,
    htmlUrl: null,
  },
  {
    slug: "daily-triage",
    title: "Daily Triage",
    description: "Repeats triage on a schedule.",
    kind: "agentLoop",
    activatable: true,
    htmlUrl: null,
    schedule: "1d",
  },
];

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
}

async function mockStoreCatalog(page: Page): Promise<unknown[]> {
  const imports: unknown[] = [];
  const imported = new Set<string>();

  const items = (): CatalogItem[] =>
    catalogSeeds.map((item) => {
      const key = `${item.kind}:${item.slug}`;
      const isImported = imported.has(key);
      return {
        ...item,
        active: false,
        status: isImported ? "customized" : "not-active",
        source: isImported ? "local" : "store",
      };
    });

  await page.route("**/api/kody/store-catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: items(),
        activeAgents: [],
        activeAgentActions: [],
        activeAgentResponsibilities: [],
        activeGoals: [],
      }),
    });
  });

  await page.route("**/api/kody/store-catalog/import", async (route) => {
    const body = route.request().postDataJSON() as {
      kind: CatalogKind;
      slug: string;
      actorLogin?: string;
    };
    imports.push(body);
    imported.add(`${body.kind}:${body.slug}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: body.kind,
        slug: body.slug,
        imported: true,
        status: "imported",
        path: `.kody/imported/${body.slug}`,
      }),
    });
  });

  return imports;
}

async function openStoreCatalog(page: Page): Promise<void> {
  await seedAuth(page);
  await mockIdentity(page);
  await page.goto("/store-catalog", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Store Catalog" }),
  ).toBeVisible({ timeout: 10_000 });
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

async function importCatalogItem(
  page: Page,
  item: { kind: CatalogKind; slug: string },
): Promise<void> {
  await page.getByTestId(`store-catalog-row-${item.kind}-${item.slug}`).click();
  const button = page.getByTestId(
    `store-catalog-import-${item.kind}-${item.slug}`,
  );
  await expect(button).toBeVisible();
  await expect(button).toContainText("Import to repo");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/kody/store-catalog/import") &&
        response.request().method() === "POST",
    ),
    button.click(),
  ]);
  await expect(button).toHaveCount(0);
  await expect(page.getByText("Customized").first()).toBeVisible();
}

test.describe("Store Catalog import", () => {
  test("imports every agentic store item type into the repo", async ({
    page,
  }) => {
    const imports = await mockStoreCatalog(page);

    await openStoreCatalog(page);

    for (const item of catalogSeeds) {
      await importCatalogItem(page, item);
    }

    expect(imports).toEqual([
      { kind: "agent", slug: "atlas-agent", actorLogin: "e2e-test" },
      { kind: "agentAction", slug: "ship-feature", actorLogin: "e2e-test" },
      {
        kind: "agentResponsibility",
        slug: "release-watch",
        actorLogin: "e2e-test",
      },
      { kind: "agentGoal", slug: "weekly-quality", actorLogin: "e2e-test" },
      { kind: "agentLoop", slug: "daily-triage", actorLogin: "e2e-test" },
    ]);
  });
});
