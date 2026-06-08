/**
 * @fileoverview Unit tests for the duty-run dispatch comment builder
 * (src/dashboard/lib/duties/run-comment.ts). The engine's `issue_comment`
 * trigger parses this literal text and routes to the `duty-tick`
 * executable — a stray rename silently breaks every "Run now" button
 * and chat `run_duty` invocation. Lock the wire text down.
 */
import { describe, expect, it } from "vitest";
import { buildDutyRunCommentBody } from "@dashboard/lib/duties/run-comment";

describe("buildDutyRunCommentBody", () => {
  it("renders the @kody duty-tick --duty <slug> --force form (default)", () => {
    // The dashboard "Run now" button calls with no `force`; we default to
    // true so a manual click always bypasses the cadence guard.
    expect(buildDutyRunCommentBody({ slug: "changelog-verify" })).toBe(
      "@kody duty-tick --duty changelog-verify --force",
    );
  });

  it("appends --force when force is true", () => {
    expect(buildDutyRunCommentBody({ slug: "qa-verify", force: true })).toBe(
      "@kody duty-tick --duty qa-verify --force",
    );
  });

  it("omits --force when force is false (lets the cadence guard decide)", () => {
    // Manual "tick on schedule" — used by callers that want the engine to
    // decide whether the duty is due, not the dashboard.
    expect(buildDutyRunCommentBody({ slug: "weekly", force: false })).toBe(
      "@kody duty-tick --duty weekly",
    );
  });

  it("uses the new subcommand and flag names (engine rename from job-tick)", () => {
    // Regression: kody2 main renamed `job-tick --job` → `duty-tick --duty`.
    // A caller that still ships the old form gets a no-op engine dispatch
    // because the trigger regex / dispatcher no longer matches.
    const body = buildDutyRunCommentBody({ slug: "x" });
    expect(body).toContain("duty-tick");
    expect(body).toContain("--duty");
    expect(body).not.toContain("job-tick");
    expect(body).not.toContain("--job");
  });
});
