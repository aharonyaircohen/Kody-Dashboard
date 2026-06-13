/**
 * @fileType api-route
 * @domain kody
 * @pattern scenario-github-api
 * @ai-summary API endpoint to create GitHub issues from scenarios
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";

function buildScenarioIssueBody(input: {
  category: string;
  area?: unknown;
  scenario: unknown;
  prototype?: unknown;
  fixture?: unknown;
  behaviors?: unknown;
  dsComponents?: unknown;
}): string {
  const lines = [
    `Category: ${input.category}`,
    input.area ? `Area: ${String(input.area)}` : "",
    input.prototype ? `Prototype: ${String(input.prototype)}` : "",
    input.fixture ? `Fixture: ${String(input.fixture)}` : "",
    "",
    "## Scenario",
    typeof input.scenario === "string"
      ? input.scenario
      : JSON.stringify(input.scenario, null, 2),
  ];

  if (input.behaviors) {
    lines.push("", "## Behaviors", JSON.stringify(input.behaviors, null, 2));
  }
  if (input.dsComponents) {
    lines.push(
      "",
      "## Design System Components",
      JSON.stringify(input.dsComponents, null, 2),
    );
  }

  return lines.filter((line) => line !== "").join("\n");
}

export async function POST(request: NextRequest) {
  const authError = await requireKodyAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      title,
      category,
      area,
      scenario,
      prototype,
      fixture,
      behaviors,
      dsComponents,
    } = body;

    if (!title || !category || !scenario) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const headerAuth = getRequestAuth(request);
    const octokit = await getUserOctokit(request);
    if (!headerAuth || !octokit) {
      return NextResponse.json(
        { error: "missing_repo_context" },
        { status: 400 },
      );
    }

    const issue = await octokit.rest.issues.create({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      title,
      body: buildScenarioIssueBody({
        category,
        area,
        scenario,
        prototype,
        fixture,
        behaviors,
        dsComponents,
      }),
      labels: ["type:scenario", `scenario:${category}`],
    });

    return NextResponse.json({
      success: true,
      number: issue.data.number,
      url: issue.data.html_url,
    });
  } catch (error) {
    console.error("Failed to create GitHub issue:", error);
    return NextResponse.json(
      { error: "Failed to create GitHub issue" },
      { status: 500 },
    );
  }
}
