import { describe, expect, it } from "vitest";

import {
  branchPreviewNeedsPoll,
  type BranchPreviewsResponse,
} from "@dashboard/lib/previews/branch-preview-client";

describe("branchPreviewNeedsPoll", () => {
  const response = (
    state: BranchPreviewsResponse["previews"][number]["state"],
    url: string | null = null,
  ): BranchPreviewsResponse => ({
    flyConfigured: true,
    previews: [{ branch: "dev", state, url }],
  });

  it("keeps polling while the selected preview is still resolving", () => {
    expect(branchPreviewNeedsPoll("dev", undefined)).toBe(true);
    expect(branchPreviewNeedsPoll("dev", response("pending"))).toBe(true);
    expect(branchPreviewNeedsPoll("dev", response("building"))).toBe(true);
    expect(branchPreviewNeedsPoll("dev", response("starting"))).toBe(true);
    expect(branchPreviewNeedsPoll("dev", response("unknown"))).toBe(true);
  });

  it("stops polling after the selected preview has a live URL", () => {
    expect(
      branchPreviewNeedsPoll(
        "dev",
        response("running", "https://branch.fly.dev?kp=fresh"),
      ),
    ).toBe(false);
  });

  it("does not poll failed or unrelated previews", () => {
    expect(branchPreviewNeedsPoll("dev", response("failed"))).toBe(false);
    expect(branchPreviewNeedsPoll("main", response("pending"))).toBe(false);
    expect(branchPreviewNeedsPoll(null, response("pending"))).toBe(false);
  });
});
