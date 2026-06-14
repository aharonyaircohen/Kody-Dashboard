/**
 * @fileoverview Tests for pickVibeRequestIssueNumber — the decision that
 * bridges the chat's task scope right after a vibe issue is created.
 * @testFramework vitest
 * @domain vibe
 *
 * Reproduces the gap: when the page has just created an issue but the chat's
 * task scope hasn't propagated yet (selectedTaskIssueNumber === null), a vibe
 * turn would carry NO issue — so the server can't bind the hand-off and the
 * model's guessed number slips through. The fallback to the just-created
 * issue closes that window.
 */

import { describe, expect, it } from "vitest";
import {
  pickVibeRequestIssueNumber,
  RECENT_VIBE_ISSUE_TTL_MS,
} from "@dashboard/lib/vibe/recent-issue";

const NOW = 1_000_000;

describe("pickVibeRequestIssueNumber", () => {
  it("falls back to the just-created issue when the task scope hasn't propagated yet", () => {
    // This is the bug window: page navigated to #42 but context.kind isn't
    // "task" yet, so selectedTaskIssueNumber is null.
    const out = pickVibeRequestIssueNumber({
      selectedTaskIssueNumber: null,
      vibeMode: true,
      recent: { issueNumber: 42, at: NOW - 3_000 },
      nowMs: NOW,
    });
    expect(out).toBe(42);
  });

  it("prefers the live resolved task scope over the remembered issue", () => {
    const out = pickVibeRequestIssueNumber({
      selectedTaskIssueNumber: 99,
      vibeMode: true,
      recent: { issueNumber: 42, at: NOW - 1_000 },
      nowMs: NOW,
    });
    expect(out).toBe(99);
  });

  it("does not use the remembered issue outside vibe mode", () => {
    const out = pickVibeRequestIssueNumber({
      selectedTaskIssueNumber: null,
      vibeMode: false,
      recent: { issueNumber: 42, at: NOW - 1_000 },
      nowMs: NOW,
    });
    expect(out).toBeNull();
  });

  it("expires the remembered issue after the TTL (no stale scope leak)", () => {
    const out = pickVibeRequestIssueNumber({
      selectedTaskIssueNumber: null,
      vibeMode: true,
      recent: { issueNumber: 42, at: NOW - (RECENT_VIBE_ISSUE_TTL_MS + 1) },
      nowMs: NOW,
    });
    expect(out).toBeNull();
  });

  it("returns null when there is neither a scope nor a remembered issue", () => {
    expect(
      pickVibeRequestIssueNumber({
        selectedTaskIssueNumber: null,
        vibeMode: true,
        recent: null,
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});
