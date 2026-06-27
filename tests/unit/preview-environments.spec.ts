import { describe, it, expect } from "vitest";

import {
  addBranchPreviewEnvironment,
  addUploadedEnvironment,
  daysUntilExpiry,
  expiredUploads,
  isFlyBranchEnvironment,
  resolveEnvironments,
  setEnvExpiry,
  STATIC_PREVIEW_TTL_MS,
  type PreviewEnvironment,
} from "@dashboard/lib/preview-environments";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function uploaded(id: string, expiresAt: number): PreviewEnvironment {
  return {
    id,
    label: id,
    url: `https://${id}.fly.dev`,
    staticId: id,
    expiresAt,
  };
}

describe("daysUntilExpiry", () => {
  it("ceils partial days and goes negative once past", () => {
    expect(daysUntilExpiry(NOW + 3 * DAY, NOW)).toBe(3);
    expect(daysUntilExpiry(NOW + 2.1 * DAY, NOW)).toBe(3); // ceil
    expect(daysUntilExpiry(NOW, NOW)).toBe(0);
    expect(daysUntilExpiry(NOW - DAY, NOW)).toBe(-1);
  });
});

describe("addUploadedEnvironment", () => {
  it("tags the new env with staticId + expiresAt", () => {
    const next = addUploadedEnvironment(
      [],
      "report.html",
      "https://kp-x.fly.dev",
      "abc123",
      NOW + STATIC_PREVIEW_TTL_MS,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      label: "report.html",
      url: "https://kp-x.fly.dev",
      staticId: "abc123",
      expiresAt: NOW + STATIC_PREVIEW_TTL_MS,
    });
  });

  it("is a no-op on a missing staticId or bad url", () => {
    expect(addUploadedEnvironment([], "x", "not-a-url", "id", NOW)).toEqual([]);
    expect(addUploadedEnvironment([], "x", "https://ok.dev", "", NOW)).toEqual(
      [],
    );
  });
});

describe("expiredUploads", () => {
  it("returns only uploaded envs at/past expiry", () => {
    const list: PreviewEnvironment[] = [
      uploaded("dead", NOW - DAY),
      uploaded("exactly-now", NOW),
      uploaded("alive", NOW + DAY),
      { id: "plain", label: "Prod", url: "https://prod.dev" }, // no expiry
    ];
    const ids = expiredUploads(list, NOW).map((e) => e.id);
    expect(ids).toEqual(["dead", "exactly-now"]);
  });

  it("never reaps a plain URL environment", () => {
    const list: PreviewEnvironment[] = [
      { id: "plain", label: "Prod", url: "https://prod.dev" },
    ];
    expect(expiredUploads(list, NOW + 10 * DAY)).toEqual([]);
  });
});

describe("setEnvExpiry", () => {
  it("updates only the matching env, immutably", () => {
    const list = [uploaded("a", NOW), uploaded("b", NOW)];
    const next = setEnvExpiry(list, "a", NOW + 5 * DAY);
    expect(next[0].expiresAt).toBe(NOW + 5 * DAY);
    expect(next[1].expiresAt).toBe(NOW);
    expect(next).not.toBe(list);
  });
});

describe("resolveEnvironments", () => {
  it("preserves staticId + expiresAt through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [uploaded("up", NOW + DAY)],
    });
    expect(out[0]).toMatchObject({ staticId: "up", expiresAt: NOW + DAY });
  });

  it("preserves Fly branch preview pointers without requiring a stored URL", () => {
    const out = resolveEnvironments({
      namedPreviews: [
        {
          id: "dev",
          label: "dev",
          flyBranch: { repo: "A-Guy-educ/A-Guy-Web", branch: "dev" },
        },
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "dev",
      label: "dev",
      flyBranch: { repo: "A-Guy-educ/A-Guy-Web", branch: "dev" },
    });
    expect(isFlyBranchEnvironment(out[0]!)).toBe(true);
  });

  it("keeps an explicit empty list empty instead of falling back to legacy url", () => {
    expect(
      resolveEnvironments({
        defaultPreviewUrl: "https://old.example.com",
        namedPreviews: [],
      }),
    ).toEqual([]);
  });
});

describe("addBranchPreviewEnvironment", () => {
  it("stores repo and branch identity, not a tokenized URL", () => {
    const next = addBranchPreviewEnvironment([], "A-Guy-educ/A-Guy-Web", "dev");

    expect(next).toEqual([
      expect.objectContaining({
        label: "dev",
        flyBranch: { repo: "A-Guy-educ/A-Guy-Web", branch: "dev" },
      }),
    ]);
    expect(next[0]!.url).toBeUndefined();
  });
});
