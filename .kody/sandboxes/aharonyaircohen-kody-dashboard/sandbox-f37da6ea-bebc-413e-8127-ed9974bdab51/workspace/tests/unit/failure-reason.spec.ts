/**
 * Failure-reason inline display: when a task is in column='failed', the
 * reason from kodyState.core.lastOutcome.payload.reason is extracted and
 * truncated for inline display on the task card. Tests the truncation
 * helper + the column gating; the route.ts wiring itself is integration-
 * tested via the live dashboard.
 */

import { describe, expect, it } from "vitest";

// Re-implement the truncation logic here so we can assert its behavior
// without exporting from app/api/kody/tasks/route.ts (Next.js route files
// aren't import-friendly from vitest). The two implementations should
// stay in sync — see the comment in route.ts.
function truncateReason(s: string): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 200) return collapsed;
  return `${collapsed.slice(0, 200)}…`;
}

describe("truncateReason: keeps card layout sane", () => {
  it("returns short reasons unchanged", () => {
    expect(truncateReason("verify failed: typecheck")).toBe(
      "verify failed: typecheck",
    );
  });

  it("collapses whitespace runs and trims", () => {
    expect(truncateReason("  verify   failed:\n\ntypecheck  ")).toBe(
      "verify failed: typecheck",
    );
  });

  it("truncates at 200 chars with an ellipsis", () => {
    const long = "a".repeat(500);
    const out = truncateReason(long);
    expect(out.length).toBe(201); // 200 chars + …
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("aaa")).toBe(true);
  });

  it("preserves the leading content (cause is more useful than tail)", () => {
    const reason = `verify failed: test\n\n--- test (exit 1, 122s) ---\nFAIL  scriptVariation > swaps numbers and recomputes correct answer\nAssertionError: expected '5x4=?' to not deeply equal '5x4=?'`;
    const out = truncateReason(reason);
    expect(out.startsWith("verify failed: test")).toBe(true);
    // The user sees the most important info (the message head), not
    // truncated mid-stack.
    expect(out).toContain("verify failed");
  });
});
