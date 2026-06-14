/**
 * Unit tests for the dynamic preview-views storage + URL join helpers
 * (src/dashboard/lib/preview-views.ts). These replace the hardcoded
 * Web/Admin buttons above the preview iframe with a user-managed list.
 *
 * The helpers are pure (no React, no DOM) so node + vitest covers them
 * directly without jsdom.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_PREVIEW_VIEWS,
  addPreviewView,
  joinPreviewUrl,
  normalizePath,
  readPreviewViews,
  removePreviewView,
  writePreviewViews,
} from "@dashboard/lib/preview-views";

describe("normalizePath", () => {
  it("forces a leading slash", () => {
    expect(normalizePath("admin")).toBe("/admin");
    expect(normalizePath("/admin")).toBe("/admin");
  });
  it("strips trailing slashes except for root", () => {
    expect(normalizePath("/admin/")).toBe("/admin");
    expect(normalizePath("/")).toBe("/");
  });
  it("strips trailing slashes before query params", () => {
    expect(normalizePath("/study/?grade=7")).toBe("/study?grade=7");
  });
  it("collapses blanks to root", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("   ")).toBe("/");
  });
});

describe("joinPreviewUrl", () => {
  it("returns base when path is root", () => {
    expect(joinPreviewUrl("https://x.dev", "/")).toBe("https://x.dev");
  });
  it("matches the legacy /admin behavior", () => {
    expect(joinPreviewUrl("https://x.dev", "/admin")).toBe(
      "https://x.dev/admin",
    );
  });
  it("avoids double slashes when base has a trailing slash", () => {
    expect(joinPreviewUrl("https://x.dev/", "/admin")).toBe(
      "https://x.dev/admin",
    );
  });
  it("normalizes a user-entered path on the fly", () => {
    expect(joinPreviewUrl("https://x.dev", "storybook")).toBe(
      "https://x.dev/storybook",
    );
  });
  it("inserts the view path before preview access query params", () => {
    expect(joinPreviewUrl("https://x.dev?kp=ticket", "/study")).toBe(
      "https://x.dev/study?kp=ticket",
    );
  });
  it("preserves query params and hash when appending a path", () => {
    expect(joinPreviewUrl("https://x.dev/base?kp=ticket#top", "/study")).toBe(
      "https://x.dev/base/study?kp=ticket#top",
    );
  });
  it("preserves query params from the selected view path", () => {
    expect(
      joinPreviewUrl(
        "https://x.dev?kp=ticket",
        "/study?grade=7&courseId=abc&locale=he",
      ),
    ).toBe("https://x.dev/study?kp=ticket&grade=7&courseId=abc&locale=he");
  });
  it("lets the selected view hash override the base hash", () => {
    expect(joinPreviewUrl("https://x.dev?kp=ticket#old", "/study#topics")).toBe(
      "https://x.dev/study?kp=ticket#topics",
    );
  });
  it("returns empty string for empty base", () => {
    expect(joinPreviewUrl("", "/admin")).toBe("");
  });
});

describe("addPreviewView / removePreviewView", () => {
  it("appends a new view with a slugged id", () => {
    const next = addPreviewView(DEFAULT_PREVIEW_VIEWS, "Storybook", "/sb");
    expect(next).toHaveLength(3);
    expect(next[2]!.name).toBe("Storybook");
    expect(next[2]!.path).toBe("/sb");
    expect(next[2]!.id.startsWith("storybook-")).toBe(true);
  });
  it("ignores empty names", () => {
    const next = addPreviewView(DEFAULT_PREVIEW_VIEWS, "  ", "/sb");
    expect(next).toEqual(DEFAULT_PREVIEW_VIEWS);
  });
  it("trims and caps long names", () => {
    const long = "a".repeat(80);
    const next = addPreviewView(DEFAULT_PREVIEW_VIEWS, long, "/x");
    expect(next[2]!.name.length).toBe(32);
  });
  it("removes by id", () => {
    expect(removePreviewView(DEFAULT_PREVIEW_VIEWS, "admin")).toEqual([
      DEFAULT_PREVIEW_VIEWS[0],
    ]);
  });
});

describe("readPreviewViews / writePreviewViews (localStorage)", () => {
  // Minimal localStorage shim so the pure helpers can be tested in node.
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      },
    };
  });

  it("seeds with defaults when nothing stored", () => {
    expect(readPreviewViews("org", "repo")).toEqual(DEFAULT_PREVIEW_VIEWS);
  });

  it("round-trips through write+read", () => {
    const views = [
      { id: "web", name: "Web", path: "/" },
      { id: "docs", name: "Docs", path: "/docs" },
    ];
    writePreviewViews("org", "repo", views);
    expect(readPreviewViews("org", "repo")).toEqual(views);
  });

  it("scopes storage per-repo (owner/repo namespaced)", () => {
    writePreviewViews("org", "a", [{ id: "x", name: "X", path: "/x" }]);
    writePreviewViews("org", "b", [{ id: "y", name: "Y", path: "/y" }]);
    expect(readPreviewViews("org", "a")[0]!.name).toBe("X");
    expect(readPreviewViews("org", "b")[0]!.name).toBe("Y");
  });

  it("falls back to defaults on malformed JSON", () => {
    (
      globalThis as unknown as {
        window: { localStorage: Storage };
      }
    ).window.localStorage.setItem("kody.previewViews.org/repo", "{not json");
    expect(readPreviewViews("org", "repo")).toEqual(DEFAULT_PREVIEW_VIEWS);
  });

  it("filters out malformed entries on read but keeps the valid ones", () => {
    const mixed = [
      { id: "valid", name: "Valid", path: "/valid" },
      { wrong: "shape" },
      null,
    ];
    (
      globalThis as unknown as {
        window: { localStorage: Storage };
      }
    ).window.localStorage.setItem(
      "kody.previewViews.org/repo",
      JSON.stringify(mixed),
    );
    expect(readPreviewViews("org", "repo")).toEqual([
      { id: "valid", name: "Valid", path: "/valid" },
    ]);
  });
});
