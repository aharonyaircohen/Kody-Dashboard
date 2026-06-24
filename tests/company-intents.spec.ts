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
      "Kody-Engine-Tester/intents/live-company-manager-20260624054307/intent.json",
      {
        version: 1,
        id: "live-company-manager-20260624054307",
        status: "active",
        for: "Validate CTO company manager live integration.",
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
          loops: ["company-manager-loop"],
          responsibilities: ["company-manager"],
        },
        manager: {
          agent: "cto",
          loop: "company-manager-loop",
          responsibility: "company-manager",
          reviewEvery: "1d",
        },
        createdAt: "2026-06-24T05:43:07.000Z",
        updatedAt: "2026-06-24T05:43:07.000Z",
      },
    );

    expect(intent.id).toBe("live-company-manager-20260624054307");
    expect(intent.manager.agent).toBe("cto");
    expect(intent.policy.release?.qaDepth).toBe("strict");
    expect(intent.policy.automation.maxConcurrentGoals).toBe(1);
  });

  it("parses decision jsonl and ignores malformed rows", () => {
    const decisions = parseCompanyIntentDecisionLog(
      [
        JSON.stringify({
          at: "2026-06-24T05:44:00.000Z",
          agent: "cto",
          intentId: "live-company-manager-20260624054307",
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
          loops: ["company-manager-loop"],
          responsibilities: ["company-manager"],
        },
        manager: { reviewEvery: "1d" },
      },
      "2026-06-24T00:00:00.000Z",
    );

    expect(intent.manager).toMatchObject({
      agent: "cto",
      loop: "company-manager-loop",
      responsibility: "company-manager",
    });
    expect(intent.createdAt).toBe("2026-06-24T00:00:00.000Z");
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
        loop: { id: "company-manager-loop", exists: false },
        responsibility: { id: "company-manager", exists: false },
      }),
    ).toEqual([
      "No metrics set",
      "No scope set",
      "Manager loop missing",
      "Manager responsibility missing",
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
    expect(view).toContain("Review now");
    expect(view).toContain("Archive");
    expect(listRoute).toContain("export async function POST");
    expect(detailRoute).toContain("export async function PATCH");
    expect(runRoute).toContain('action: "company-manager"');
  });
});
