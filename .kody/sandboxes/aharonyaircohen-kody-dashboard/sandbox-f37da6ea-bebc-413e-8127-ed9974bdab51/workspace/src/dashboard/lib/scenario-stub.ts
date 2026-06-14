/**
 * @fileType utility
 * @domain kody
 * @pattern scenario-helpers
 * @ai-summary Lightweight scenario helpers used by the standalone dashboard.
 */
import fs from "fs/promises";
import path from "path";
import type {
  DesignSystemComponent,
  PrototypeElement,
  Scenario,
  ScenarioStep,
} from "@dashboard/lib/scenario-schema-stub";
import {
  parseSafeFileStem,
  resolveUnderBase,
} from "@dashboard/lib/scenario-paths";

const PROTOTYPE_BASE_PATH = path.resolve(process.cwd(), "site-docs/prototypes");

function asScenario(value: unknown): Partial<Scenario> {
  return value && typeof value === "object" ? (value as Partial<Scenario>) : {};
}

function normalizeSteps(value: unknown): ScenarioStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step): step is ScenarioStep => !!step && typeof step === "object")
    .map((step, index) => ({
      id: step.id ?? `step-${index + 1}`,
      type: step.type ?? "action",
      action: step.action,
      target: step.target,
      component: step.component,
      expected: step.expected,
      description: step.description,
    }));
}

export function convertScenarioToIssue(scenario: unknown): {
  title: string;
  body: string;
} {
  const parsed = asScenario(scenario);
  const title = parsed.name || "Scenario";
  const steps = normalizeSteps(parsed.steps);
  const body = [
    parsed.description || "",
    "",
    "## Steps",
    ...steps.map(
      (step, index) =>
        `${index + 1}. ${step.type}: ${[step.action, step.target].filter(Boolean).join(" ")}`,
    ),
  ].join("\n");
  return { title, body };
}

export function importScenarioFromGitHub(
  _issueNumber: number,
): Promise<unknown> {
  return Promise.reject(
    new Error("Importing scenarios from GitHub is not available here."),
  );
}

export function convertToQAFormat(
  scenario: unknown,
  options?: unknown,
): unknown {
  const parsed = asScenario(scenario);
  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description ?? "",
    type: parsed.type ?? "feature",
    status: parsed.status ?? "draft",
    steps: normalizeSteps(parsed.steps).map((step) => ({
      type: step.type,
      action: step.action ?? "",
      target: step.target ?? "",
      component: step.component,
      expected: step.expected,
    })),
    options: options ?? {},
    metadata: parsed.metadata ?? {},
  };
}

export function generatePlaywrightTest(
  scenario: unknown,
  options?: unknown,
): string {
  const parsed = asScenario(scenario);
  const testName = parsed.name || parsed.id || "scenario";
  const steps = normalizeSteps(parsed.steps);
  const baseUrl =
    options && typeof options === "object" && "baseUrl" in options
      ? String((options as { baseUrl?: unknown }).baseUrl)
      : "/";

  const body = steps
    .map((step) => {
      const action = String(step.action ?? "").toLowerCase();
      const target = String(step.target ?? "");
      if (action.includes("navigate") || step.type === "navigation") {
        return `  await page.goto(${JSON.stringify(target || baseUrl)});`;
      }
      if (action.includes("click")) {
        return `  await page.locator(${JSON.stringify(target)}).click();`;
      }
      if (action.includes("fill") || action.includes("type")) {
        return `  await page.locator(${JSON.stringify(target)}).fill("");`;
      }
      if (step.expected || step.type === "assertion") {
        return `  await expect(page.locator(${JSON.stringify(target || "body")})).toBeVisible();`;
      }
      return `  // ${[step.type, step.action, step.target].filter(Boolean).join(" ")}`;
    })
    .join("\n");

  return `import { test, expect } from "@playwright/test";

test(${JSON.stringify(testName)}, async ({ page }) => {
${body || `  await page.goto(${JSON.stringify(baseUrl)});`}
});
`;
}

export function createScenarioIssue(
  _params: Record<string, unknown>,
): Promise<{ number: number; html_url: string }> {
  return Promise.reject(
    new Error("Use the authenticated scenario GitHub API route."),
  );
}

export async function loadDesignSystemComponents(): Promise<
  DesignSystemComponent[]
> {
  return [];
}

export async function listPrototypes(): Promise<string[]> {
  try {
    const entries = await fs.readdir(PROTOTYPE_BASE_PATH, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => entry.name.replace(/\.html$/i, ""))
      .filter((name) => parseSafeFileStem(name));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

function extractElements(html: string): PrototypeElement[] {
  const elements: PrototypeElement[] = [];
  const tagPattern =
    /<(button|a|input|textarea|select|form|label|section|div|span)\b([^>]*)>(.*?)<\/\1>|<(input)\b([^>]*)\/?>/gis;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[1] || match[4] || "element";
    const attrs = match[2] || match[5] || "";
    const innerText = (match[3] || "").replace(/<[^>]+>/g, "").trim();
    const idAttr = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    const classes =
      attrs
        .match(/\bclass=["']([^"']+)["']/i)?.[1]
        ?.split(/\s+/)
        .filter(Boolean) ?? [];
    const selector = idAttr
      ? `#${idAttr}`
      : classes.length
        ? `.${classes[0]}`
        : tag;

    elements.push({
      id: idAttr || `${tag}-${index + 1}`,
      tag,
      idAttr,
      classes,
      text: innerText,
      selector,
    });
    index += 1;
  }

  return elements;
}

export async function loadPrototype(name: string): Promise<unknown> {
  const safeName = parseSafeFileStem(name);
  if (!safeName) return null;

  const filePath = resolveUnderBase(PROTOTYPE_BASE_PATH, `${safeName}.html`);
  if (!filePath) return null;

  try {
    const html = await fs.readFile(filePath, "utf8");
    return {
      name: safeName,
      html,
      elements: extractElements(html),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}
