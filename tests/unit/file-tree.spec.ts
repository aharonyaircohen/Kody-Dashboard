/**
 * Unit tests for FileTree's pure buildTree() helper.
 *
 * The /files tree bug (regression test): previously, `buildTree` set
 * `children` to `null` whenever an entry's children had been loaded,
 * and to `[]` otherwise — never recursing to build the nested
 * `TreeNode[]`s. As a result, every folder rendered as empty and
 * clicking a folder did nothing. These tests assert that
 *   1. an open directory whose children are present in the childrenMap
 *      gets a non-null `children` array containing the right nested
 *      `TreeNode`s (the original PR-regression case);
 *   2. files get `children: null` (so the render guard renders nothing);
 *   3. closed directories get `children: null` (same);
 *   4. an open directory without cached children gets `children: []`
 *      (so the row renders but the loading spinner shows).
 */
import { describe, it, expect } from "vitest";
import {
  ancestorPaths,
  buildTree,
  pathAndAncestorPaths,
} from "@dashboard/components/files/FileTree";
import type { FileEntry } from "@dashboard/lib/repo-files";

function file(name: string, path: string, size = 10): FileEntry {
  return { name, path, type: "file", size, sha: `sha-${name}` };
}

function dir(name: string, path: string): FileEntry {
  return { name, path, type: "dir", size: 0, sha: `sha-${name}` };
}

describe("buildTree", () => {
  it("regression: open dir with cached children gets a nested TreeNode[]", () => {
    // Sample childrenMap: app is loaded, contains page.tsx and api/.
    const appChildren: FileEntry[] = [
      file("page.tsx", "app/page.tsx", 100),
      dir("api", "app/api"),
    ];
    const childrenMap: Record<string, FileEntry[]> = {
      app: appChildren,
    };
    const rootEntries: FileEntry[] = [dir("app", "app")];
    const openPaths = new Set<string>(["app"]);
    const loadingPaths = new Set<string>();
    const sortKey = "name";

    const tree = buildTree(
      rootEntries,
      childrenMap,
      openPaths,
      loadingPaths,
      sortKey,
    );

    // The root row is the `app` directory.
    expect(tree).toHaveLength(1);
    const appNode = tree[0]!;
    expect(appNode.entry.path).toBe("app");
    expect(appNode.isOpen).toBe(true);

    // The bug: this was `null`. After the fix it is the nested tree.
    expect(appNode.children).not.toBeNull();
    expect(appNode.children).toHaveLength(2);

    // Both `app/page.tsx` and `app/api` must be present as nested
    // TreeNodes, in name-sorted order (dirs first, then files).
    const paths = appNode.children!.map((c) => c.entry.path);
    expect(paths).toEqual(["app/api", "app/page.tsx"]);

    const apiNode = appNode.children!.find((c) => c.entry.path === "app/api")!;
    const pageNode = appNode.children!.find(
      (c) => c.entry.path === "app/page.tsx",
    )!;

    // `app/api` is a closed dir, so its children are null (render
    // guard skips them). `isOpen` is false.
    expect(apiNode.entry.type).toBe("dir");
    expect(apiNode.isOpen).toBe(false);
    expect(apiNode.children).toBeNull();

    // `app/page.tsx` is a file, so its children are null.
    expect(pageNode.entry.type).toBe("file");
    expect(pageNode.children).toBeNull();
  });

  it("files get children: null", () => {
    const tree = buildTree(
      [file("README.md", "README.md")],
      {},
      new Set<string>(),
      new Set<string>(),
      "name",
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]!.entry.type).toBe("file");
    expect(tree[0]!.children).toBeNull();
  });

  it("closed directories get children: null", () => {
    // app/ exists in childrenMap but is NOT in openPaths.
    const tree = buildTree(
      [dir("app", "app")],
      { app: [file("page.tsx", "app/page.tsx")] },
      new Set<string>(), // not open
      new Set<string>(),
      "name",
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]!.entry.type).toBe("dir");
    expect(tree[0]!.isOpen).toBe(false);
    // The bug had this returning either null (when cached) or [].
    // Correctly, a closed dir gets null so the render guard skips it.
    expect(tree[0]!.children).toBeNull();
  });

  it("open directory with no cached children gets children: []", () => {
    // app/ is in openPaths but not in childrenMap — the listDir fetch
    // is still in flight. The row should render (so the spinner can
    // show) but render no children until the fetch resolves.
    const tree = buildTree(
      [dir("app", "app")],
      {}, // empty childrenMap
      new Set<string>(["app"]),
      new Set<string>(["app"]),
      "name",
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]!.isOpen).toBe(true);
    expect(tree[0]!.isLoading).toBe(true);
    expect(tree[0]!.children).toEqual([]);
  });

  it("sorts entries with directories first, then files, by name", () => {
    const root: FileEntry[] = [
      file("zeta.tsx", "zeta.tsx"),
      dir("alpha", "alpha"),
      file("alpha.tsx", "alpha.tsx"),
      dir("beta", "beta"),
    ];
    const tree = buildTree(
      root,
      {},
      new Set<string>(),
      new Set<string>(),
      "name",
    );
    expect(tree.map((n) => n.entry.name)).toEqual([
      "alpha",
      "beta",
      "alpha.tsx",
      "zeta.tsx",
    ]);
  });
});

describe("path helpers", () => {
  it("returns only parent folders for a file path", () => {
    expect(ancestorPaths("src/components/Button.tsx")).toEqual([
      "src",
      "src/components",
    ]);
  });

  it("returns the folder and its parents for a folder path", () => {
    expect(pathAndAncestorPaths("src/components")).toEqual([
      "src",
      "src/components",
    ]);
  });

  it("returns no parents for a root file", () => {
    expect(ancestorPaths("README.md")).toEqual([]);
  });
});
