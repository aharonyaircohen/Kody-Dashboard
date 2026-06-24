import { describe, it, expect } from "vitest";

import {
  addRepoViewEnvironment,
  addUploadedEnvironment,
  daysUntilExpiry,
  expiredUploads,
  normalizeEnvUrl,
  normalizeRepoViewPath,
  repoViewIdFromPath,
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

  it("keeps a readable upload context for chat", () => {
    const next = addUploadedEnvironment(
      [],
      "landing.html",
      "https://kp-x.fly.dev",
      "abc123",
      NOW + STATIC_PREVIEW_TTL_MS,
      {
        name: "landing.html",
        mimeType: "text/html",
        size: 2048,
        title: "Landing",
        outline: "h1: Welcome\nbutton: Start",
      },
    );
    expect(next[0].uploadContext).toMatchObject({
      name: "landing.html",
      title: "Landing",
      outline: "h1: Welcome\nbutton: Start",
    });
  });

  it("is a no-op on a missing staticId or bad url", () => {
    expect(addUploadedEnvironment([], "x", "not-a-url", "id", NOW)).toEqual([]);
    expect(addUploadedEnvironment([], "x", "https://ok.dev", "", NOW)).toEqual(
      [],
    );
  });
});

describe("repo view paths", () => {
  it("reads legacy and state-root repo view paths", () => {
    expect(repoViewIdFromPath(".kody/views/mobile-html-1234")).toBe(
      "mobile-html-1234",
    );
    expect(repoViewIdFromPath("views/mobile-html-1234")).toBe(
      "mobile-html-1234",
    );
  });

  it("stores new repo view environments with state-root paths", () => {
    expect(normalizeRepoViewPath(".kody/views/mobile-html-1234")).toBe(
      "views/mobile-html-1234",
    );

    const next = addRepoViewEnvironment(
      [],
      "Mobile",
      "/api/kody/views/mobile-html-1234/index.html",
      ".kody/views/mobile-html-1234",
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.repoViewPath).toBe("views/mobile-html-1234");
  });
});

describe("normalizeEnvUrl", () => {
  it("accepts dashboard-served view URLs", () => {
    expect(normalizeEnvUrl("/api/kody/views/mobile-html-1234/index.html")).toBe(
      "/api/kody/views/mobile-html-1234/index.html",
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
  it("treats an explicit empty list as empty instead of falling back", () => {
    expect(
      resolveEnvironments({
        namedPreviews: [],
        defaultPreviewUrl: "https://legacy.example.com",
      }),
    ).toEqual([]);
  });

  it("preserves staticId + expiresAt through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [uploaded("up", NOW + DAY)],
    });
    expect(out[0]).toMatchObject({ staticId: "up", expiresAt: NOW + DAY });
  });

  it("preserves uploadContext through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [
        {
          ...uploaded("up", NOW + DAY),
          uploadContext: {
            name: "up.html",
            mimeType: "text/html",
            size: 123,
            outline: "h1: Uploaded",
          },
        },
      ],
    });
    expect(out[0].uploadContext).toMatchObject({
      name: "up.html",
      outline: "h1: Uploaded",
    });
  });
});
