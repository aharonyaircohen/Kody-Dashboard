/**
 * Tests for the generalized agent-recommendation detector. Any agent
 * (CTO, QA, …) can emit a recommendation; each tags itself with a hidden
 * `<!-- kody-agent: <slug> -->` line so the dashboard tallies its verdict
 * under that agent's own trust ledger. Legacy recs (CTO marker, no
 * slug line) default to the CTO. The slug marker must never reach the user —
 * it's stripped from the inbox snippet.
 */
import { describe, expect, it } from "vitest";
import {
  parseCtoAgent,
  parseCtoAction,
  parseCtoCommand,
  detectCtoRecommendation,
} from "@dashboard/lib/cto/recommendation";
import { buildSnippet } from "@dashboard/lib/inbox/types";
import type { InboxEntry } from "@dashboard/lib/inbox/types";

const REPO = "acme/widgets";

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: "x",
    source: "mention",
    repoFullName: REPO,
    threadType: "Issue",
    title: "Task 42",
    snippet: "",
    url: `https://github.com/${REPO}/issues/42`,
    sentAt: "2026-05-22T00:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

const CTO_BODY = [
  "@aguyaharonyair 🧭 **CTO recommendation** — `execute`",
  "",
  "Backlog task #42 is ready.",
  "",
  "<!-- kody-cmd: @kody -->",
  "<!-- kody-agent: cto -->",
].join("\n");

const QA_BODY = [
  "@aguyaharonyair 🧪 **QA result** — `fix`",
  "",
  "Three findings on the checkout flow.",
  "",
  "<!-- kody-cmd: @kody fix --pr 42 -->",
  "<!-- kody-agent: qa -->",
].join("\n");

describe("parseCtoAgent", () => {
  it("reads the slug from the kody-agent line", () => {
    expect(parseCtoAgent(QA_BODY)).toBe("qa");
    expect(parseCtoAgent(CTO_BODY)).toBe("cto");
  });

  it("is case-insensitive and lowercases the slug", () => {
    expect(parseCtoAgent("<!-- kody-agent: QA -->")).toBe("qa");
  });

  it("accepts hyphenated slugs", () => {
    expect(parseCtoAgent("<!-- kody-agent: release-manager -->")).toBe(
      "release-manager",
    );
  });

  it("returns null when the line is absent", () => {
    expect(parseCtoAgent("just a normal comment")).toBeNull();
  });
});

describe("parseCtoAction — generalized detection", () => {
  it("detects a QA rec via the kody-agent line (no CTO marker present)", () => {
    // The QA marker is "QA result", which the legacy MARKER never matched.
    // The explicit kody-agent line is what makes it a recognised rec now.
    expect(parseCtoAction(QA_BODY)).toBe("fix");
  });

  it("detects a legacy CTO rec via the prose marker", () => {
    const legacy = "@aguyaharonyair 🧭 **CTO recommendation** — `execute`";
    expect(parseCtoAction(legacy)).toBe("execute");
  });

  it("returns 'other' when a rec is tagged but the verb is unrecoverable", () => {
    const body =
      "<!-- kody-agent: qa -->\nsome freeform note with no known verb";
    expect(parseCtoAction(body)).toBe("other");
  });

  it("returns null for a plain comment (no marker, no agent line)", () => {
    expect(
      parseCtoAction("hey @aguyaharonyair can you look at this?"),
    ).toBeNull();
  });
});

describe("detectCtoRecommendation — agent scoping", () => {
  it("returns the QA slug for a QA rec", () => {
    const rec = detectCtoRecommendation(
      entry({
        ctoAction: "fix",
        ctoAgent: "qa",
        ctoCommand: "@kody fix --pr 42",
      }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.agent).toBe("qa");
    expect(rec!.action).toBe("fix");
  });

  it("defaults to the CTO slug for a legacy entry with no ctoAgent", () => {
    const rec = detectCtoRecommendation(
      entry({ ctoAction: "execute", snippet: "CTO recommendation" }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.agent).toBe("cto");
  });

  it("returns null for a non-recommendation mention", () => {
    expect(detectCtoRecommendation(entry({ snippet: "hi" }))).toBeNull();
  });
});

describe("non-engine verbs never get dispatched", () => {
  it("parseCtoCommand rejects a dead `@kody approve` command", () => {
    expect(parseCtoCommand("<!-- kody-cmd: @kody approve -->")).toBeNull();
    expect(parseCtoCommand("<!-- kody-cmd: @kody reject -->")).toBeNull();
  });

  it("parseCtoCommand still accepts a real engine verb", () => {
    expect(parseCtoCommand("<!-- kody-cmd: @kody fix --pr 42 -->")).toBe(
      "@kody fix --pr 42",
    );
    // Bare `@kody` (execute) has no verb — must remain valid.
    expect(parseCtoCommand("<!-- kody-cmd: @kody -->")).toBe("@kody");
  });

  it("detectCtoRecommendation drops a stored `@kody approve` to read-only", () => {
    // A QA rec persisted before the fix carried `@kody approve` as its command.
    const rec = detectCtoRecommendation(
      entry({ ctoAction: "fix", ctoAgent: "qa", ctoCommand: "@kody approve" }),
    );
    expect(rec).not.toBeNull();
    // Falls back to the verb→command map (fix → @kody), never the dead verb.
    expect(rec!.command).not.toBe("@kody approve");
  });
});

describe("the kody-agent marker stays hidden from the operator", () => {
  it("buildSnippet strips the kody-agent HTML comment", () => {
    const snippet = buildSnippet(QA_BODY);
    expect(snippet).not.toContain("kody-agent");
    expect(snippet).not.toContain("kody-cmd");
    expect(snippet).not.toContain("<!--");
    // The human-readable reason still survives.
    expect(snippet).toContain("Three findings");
  });
});
