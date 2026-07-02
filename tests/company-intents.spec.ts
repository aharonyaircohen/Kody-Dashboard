import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildCompanyIntent,
  companyIntentWarnings,
  parseCompanyIntent,
  parseCompanyIntentDecisionLog,
  slugifyCompanyIntentId,
  sortCompanyIntentRecords,
  type CompanyIntentRecord,
} from "../src/dashboard/lib/company-intents";

describe("company intents", () => {
  it("parses the engine intent file shape", () => {
    const intent = parseCompanyIntent(
      "Kody-Engine-Tester/intents/live-agency-architect-20260624054307/intent.json",
      {
        version: 1,
        id: "live-agency-architect-20260624054307",
        status: "active",
        for: "Validate CTO agency architect live integration.",
        description:
          "Use this to prove Agency Architect understands deeper operator context.",
        priority: 10,
        posture: "confidence",
        scope: { repos: ["A-Guy-educ/Kody-Engine-Tester"], areas: ["release"] },
        principles: ["Do not create portfolio work without evidence."],
        metrics: ["No unintended goals created."],
        policy: {
          release: {
            cadence: "manual",
            qaDepth: "strict",
            blockerLevel: "strict",
            approval: "before-risky-actions",
          },
          automation: {
            authority: "full-auto",
            maxConcurrentGoals: 1,
            maxDailyActions: 3,
            requiresHumanFor: ["production deploy"],
          },
        },
        portfolio: {
          goals: [],
          loops: ["agency-architect-loop"],
          capabilities: ["agency-architect"],
        },
        manager: {
          agent: "cto",
          loop: "agency-architect-loop",
          capability: "agency-architect",
          reviewEvery: "1d",
        },
        createdAt: "2026-06-24T05:43:07.000Z",
        updatedAt: "2026-06-24T05:43:07.000Z",
      },
    );

    expect(intent.id).toBe("live-agency-architect-20260624054307");
    expect(intent.description).toBe(
      "Use this to prove Agency Architect understands deeper operator context.",
    );
    expect(intent.manager.agent).toBe("cto");
    expect(intent.policy.release?.qaDepth).toBe("strict");
    expect(intent.policy.automation.maxConcurrentGoals).toBe(1);
  });

  it("preserves 15-minute release cadence", () => {
    const intent = parseCompanyIntent("intents/prs-stay-mergeable/intent.json", {
      id: "prs-stay-mergeable",
      for: "Keep PRs mergeable.",
      policy: {
        release: { cadence: "15m" },
        automation: { authority: "full-auto" },
      },
      manager: { agent: "cto" },
    });

    expect(intent.policy.release?.cadence).toBe("15m");
  });

  it("parses decision jsonl and ignores malformed rows", () => {
    const decisions = parseCompanyIntentDecisionLog(
      [
        JSON.stringify({
          at: "2026-06-24T05:44:00.000Z",
          agent: "cto",
          intentId: "live-agency-architect-20260624054307",
          action: "note",
          reason: "Portfolio remains empty.",
        }),
        "not json",
      ].join("\n"),
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      agent: "cto",
      action: "note",
      reason: "Portfolio remains empty.",
    });
  });

  it("sorts by priority then id", () => {
    const makeRecord = (id: string, priority: number): CompanyIntentRecord => ({
      id,
      path: `intents/${id}/intent.json`,
      decisions: [],
      intent: parseCompanyIntent(`intents/${id}/intent.json`, {
        id,
        priority,
        for: id,
        policy: { automation: { authority: "full-auto" } },
        manager: { agent: "cto" },
      }),
    });

    expect(
      sortCompanyIntentRecords([
        makeRecord("release-health", 20),
        makeRecord("agency-health", 10),
        makeRecord("agency-beta", 10),
      ]).map((record) => record.id),
    ).toEqual(["agency-beta", "agency-health", "release-health"]);
  });

  it("builds normalized operator-created intents", () => {
    const intent = buildCompanyIntent(
      {
        id: "release-health",
        for: "Keep releases healthy.",
        description: "Prefer boring release flow with evidence before action.",
        priority: 3,
        status: "active",
        posture: "balanced",
        scope: { repos: ["A-Guy-educ/Kody-Engine-Tester"], areas: [] },
        principles: ["Prefer small checks."],
        metrics: ["Release has validation evidence."],
        policy: {
          release: {
            cadence: "manual",
            qaDepth: "standard",
            blockerLevel: "standard",
            approval: "before-risky-actions",
          },
          automation: {
            authority: "full-auto",
            maxConcurrentGoals: 1,
            maxDailyActions: 5,
            requiresHumanFor: ["production deploy"],
          },
        },
        portfolio: {
          goals: ["release-health"],
          loops: ["agency-architect-loop"],
          capabilities: ["agency-architect"],
        },
        manager: { reviewEvery: "1d" },
      },
      "2026-06-24T00:00:00.000Z",
    );

    expect(intent.manager).toMatchObject({
      agent: "cto",
      loop: "agency-architect-loop",
      capability: "agency-architect",
    });
    expect(intent.createdAt).toBe("2026-06-24T00:00:00.000Z");
    expect(intent.description).toBe(
      "Prefer boring release flow with evidence before action.",
    );
  });

  it("slugifies and warns on incomplete operating guidance", () => {
    expect(slugifyCompanyIntentId("Release Health!")).toBe("release-health");
    const intent = parseCompanyIntent("intents/release-health/intent.json", {
      id: "release-health",
      for: "Release health",
      policy: { automation: { authority: "full-auto" } },
      manager: { agent: "cto" },
    });

    expect(
      companyIntentWarnings(intent, {
        loop: { id: "agency-architect-loop", exists: false },
        capability: { id: "agency-architect", exists: false },
      }),
    ).toEqual([
      "No metrics set",
      "No scope set",
      "Manager loop missing",
      "Manager capability missing",
    ]);
  });

  it("exposes the full Dashboard workflow surfaces", () => {
    const view = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/lib/components/CompanyIntentsView.tsx",
      ),
      "utf8",
    );
    const listRoute = readFileSync(
      resolve(process.cwd(), "app/api/kody/company/intents/route.ts"),
      "utf8",
    );
    const detailRoute = readFileSync(
      resolve(process.cwd(), "app/api/kody/company/intents/[id]/route.ts"),
      "utf8",
    );
    const runRoute = readFileSync(
      resolve(process.cwd(), "app/api/kody/company/intents/[id]/run/route.ts"),
      "utf8",
    );

    expect(view).toContain("New intent");
    expect(view).toContain('aria-label="Review now"');
    expect(view).toContain('aria-label="Archive intent"');
    expect(view).toContain('className="h-8 w-8 px-0"');
    expect(view).toContain("What should Kody care about?");
    expect(view).toContain("More context");
    expect(view).toContain("MarkdownEditor");
    expect(view).toContain("max-w-5xl");
    expect(view).toContain('label: "Cautious"');
    expect(view).toContain('label: "Fast"');
    expect(view).not.toContain('label: "Maintenance"');
    expect(view).not.toContain("Applies to");
    expect(view).not.toContain("Portfolio seeds");
    expect(listRoute).toContain("export async function POST");
    expect(detailRoute).toContain("export async function PATCH");
    expect(runRoute).toContain('action: "agency-architect"');
  });
});
