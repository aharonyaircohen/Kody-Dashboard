import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mintBranchPreviewTicket,
  mintPreviewTicket,
  verifyBranchPreviewTicket,
  verifyPreviewTicket,
} from "@dashboard/lib/preview-token";

const ORIGINAL_KEY = process.env.KODY_MASTER_KEY;

beforeEach(() => {
  process.env.KODY_MASTER_KEY = "a".repeat(64);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-27T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_KEY === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = ORIGINAL_KEY;
});

describe("preview tickets", () => {
  it("verifies PR tickets only for the signed repo and PR", () => {
    const { ticket } = mintPreviewTicket("owner/repo", 12, 60);

    expect(verifyPreviewTicket(ticket, "owner/repo", 12)).toBe(true);
    expect(verifyPreviewTicket(ticket, "owner/repo", 13)).toBe(false);
    expect(verifyPreviewTicket(ticket, "other/repo", 12)).toBe(false);
  });

  it("verifies branch tickets only for the signed repo and branch", () => {
    const { ticket } = mintBranchPreviewTicket("owner/repo", "dev", 60);

    expect(verifyBranchPreviewTicket(ticket, "owner/repo", "dev")).toBe(true);
    expect(verifyBranchPreviewTicket(ticket, "owner/repo", "main")).toBe(false);
  });

  it("rejects expired tickets", () => {
    const { ticket } = mintPreviewTicket("owner/repo", 12, 60);

    vi.setSystemTime(new Date("2026-06-27T00:01:01Z"));

    expect(verifyPreviewTicket(ticket, "owner/repo", 12)).toBe(false);
  });
});
