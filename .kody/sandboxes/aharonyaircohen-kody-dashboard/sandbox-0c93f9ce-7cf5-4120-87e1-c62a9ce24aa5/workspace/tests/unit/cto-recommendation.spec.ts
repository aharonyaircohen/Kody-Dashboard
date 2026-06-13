/**
 * Tests for the generalized staff-recommendation detector. Any staff member
 * (CTO, QA, …) can emit a recommendation; each tags itself with a hidden
 * `<!-- kody-staff: <slug> -->` line so the dashboard tallies its verdict
 * under that staff member's own trust ledger. Legacy recs (CTO marker, no
 * slug line) default to the CTO. The slug marker must never reach the user —
 * it's stripped from the inbox snippet.
 */
import { describe, expect, it } from "vitest";
import {
  parseCtoStaff,
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
  "<!-- kody-staff: cto -->",
].join("\n");

const QA_BODY = [
  "@aguyaharonyair 🧪 **QA result** — `fix`",
  "",
  "Three findings on the checkout flow.",
  "",
  "<!-- kody-cmd: @kody fix --pr 42 -->",
  "<!-- kody-staff: qa -->",
].join("\n");

describe("parseCtoStaff", () => {
  it("reads the slug from the kody-staff line", () => {
    expect(parseCtoStaff(QA_BODY)).toBe("qa");
    expect(parseCtoStaff(CTO_BODY)).toBe("cto");
  });

  it("is case-insensitive and lowercases the slug", () => {
    expect(parseCtoStaff("<!-- kody-staff: QA -->")).toBe("qa");
  });

  it("accepts hyphenated slugs", () => {
    expect(parseCtoStaff("<!-- kody-staff: release-manager -->")).toBe(
      "release-manager",
    );
  });

  it("returns null when the line is absent", () => {
    expect(parseCtoStaff("just a normal comment")).toBeNull();
  });
});

describe("parseCtoAction — generalized detection", () => {
  it("detects a QA rec via the kody-staff line (no CTO marker present)", () => {
    // The QA marker is "QA result", which the legacy MARKER never matched.
    // The explicit kody-staff line is what makes it a recognised rec now.
    expect(parseCtoAction(QA_BODY)).toBe("fix");
  });

  it("detects a legacy CTO rec via the prose marker", () => {
    const legacy = "@aguyaharonyair 🧭 **CTO recommendation** — `execute`";
    expect(parseCtoAction(legacy)).toBe("execute");
  });

  it("returns 'other' when a rec is tagged but the verb is unrecoverable", () => {
    const body =
      "<!-- kody-staff: qa -->\nsome freeform note with no known verb";
    expect(parseCtoAction(body)).toBe("other");
  });

  it("returns null for a plain comment (no marker, no staff line)", () => {
    expect(
      parseCtoAction("hey @aguyaharonyair can you look at this?"),
    ).toBeNull();
  });
});

describe("detectCtoRecommendation — staff scoping", () => {
  it("returns the QA slug for a QA rec", () => {
    const rec = detectCtoRecommendation(
      entry({
        ctoAction: "fix",
        ctoStaff: "qa",
        ctoCommand: "@kody fix --pr 42",
      }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.staff).toBe("qa");
    expect(rec!.action).toBe("fix");
  });

  it("defaults to the CTO slug for a legacy entry with no ctoStaff", () => {
    const rec = detectCtoRecommendation(
      entry({ ctoAction: "execute", snippet: "CTO recommendation" }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.staff).toBe("cto");
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
      entry({ ctoAction: "fix", ctoStaff: "qa", ctoCommand: "@kody approve" }),
    );
    expect(rec).not.toBeNull();
    // Falls back to the verb→command map (fix → @kody), never the dead verb.
    expect(rec!.command).not.toBe("@kody approve");
  });
});

describe("the kody-staff marker stays hidden from the operator", () => {
  it("buildSnippet strips the kody-staff HTML comment", () => {
    const snippet = buildSnippet(QA_BODY);
    expect(snippet).not.toContain("kody-staff");
    expect(snippet).not.toContain("kody-cmd");
    expect(snippet).not.toContain("<!--");
    // The human-readable reason still survives.
    expect(snippet).toContain("Three findings");
  });
});
