/**
 * Unit tests for FilesPage breadcrumb-building logic.
 */
import { describe, it, expect } from "vitest";
import {
  buildBreadcrumbs,
  buildFileHref,
  normalizeRepoPath,
} from "@dashboard/components/files/FilesPage";

describe("buildBreadcrumbs", () => {
  it("returns empty array for empty path", () => {
    expect(buildBreadcrumbs("")).toEqual([]);
  });

  it("returns single item for a file in root", () => {
    expect(buildBreadcrumbs("README.md")).toEqual([
      { path: "README.md", label: "README.md" },
    ]);
  });

  it("builds correct trail for a nested file", () => {
    expect(buildBreadcrumbs("src/components/Button.tsx")).toEqual([
      { path: "src", label: "src" },
      { path: "src/components", label: "components" },
      { path: "src/components/Button.tsx", label: "Button.tsx" },
    ]);
  });

  it("builds correct trail for deeply nested path", () => {
    const result = buildBreadcrumbs("a/b/c/d/e.txt");
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ path: "a", label: "a" });
    expect(result[2]).toEqual({ path: "a/b/c", label: "c" });
    expect(result[4]).toEqual({ path: "a/b/c/d/e.txt", label: "e.txt" });
  });

  it("each crumb's path is the full prefix path", () => {
    const result = buildBreadcrumbs("foo/bar/baz.txt");
    expect(result[0].path).toBe("foo");
    expect(result[1].path).toBe("foo/bar");
    expect(result[2].path).toBe("foo/bar/baz.txt");
  });

  it("label is always just the final segment", () => {
    const result = buildBreadcrumbs("foo/bar/baz.txt");
    expect(result[0].label).toBe("foo");
    expect(result[1].label).toBe("bar");
    expect(result[2].label).toBe("baz.txt");
  });

  it("handles paths with dots in directory names", () => {
    const result = buildBreadcrumbs(".github/workflows/ci.yml");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ path: ".github", label: ".github" });
    expect(result[1]).toEqual({
      path: ".github/workflows",
      label: "workflows",
    });
    expect(result[2]).toEqual({
      path: ".github/workflows/ci.yml",
      label: "ci.yml",
    });
  });
});

describe("normalizeRepoPath", () => {
  it("removes leading and trailing slashes", () => {
    expect(normalizeRepoPath("/src/components/")).toBe("src/components");
  });

  it("collapses repeated separators", () => {
    expect(normalizeRepoPath("src//components///Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });
});

describe("buildFileHref", () => {
  it("returns the files root for an empty path", () => {
    expect(buildFileHref("")).toBe("/files");
  });

  it("builds a nested file route", () => {
    expect(buildFileHref("src/components/Button.tsx")).toBe(
      "/files/src/components/Button.tsx",
    );
  });

  it("encodes URL-sensitive path segments", () => {
    expect(buildFileHref("docs/What now?.md")).toBe(
      "/files/docs/What%20now%3F.md",
    );
  });
});
