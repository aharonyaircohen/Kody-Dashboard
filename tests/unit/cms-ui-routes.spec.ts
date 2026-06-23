import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("CMS UI routes", () => {
  it("has a first-class edit route wired to the edit manager", () => {
    const path = "app/(chat-rail)/cms/[collection]/[id]/edit/page.tsx";

    expect(existsSync(resolve(root, path))).toBe(true);
    expect(readRepoFile(path)).toContain("CmsEditManager");
    expect(
      readRepoFile("src/dashboard/lib/components/CmsManager.tsx"),
    ).toContain("export function CmsEditManager");
  });

  it("renders CMS forms with explicit cancel handling", () => {
    const source = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");

    expect(source).toContain("onCancel");
    expect(source).toContain("Cancel");
  });

  it("keeps CMS table filters mounted while documents load", () => {
    const source = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const start = source.indexOf("function CollectionWorkspace");
    const end = source.indexOf("function CrudActions");
    const workspace = source.slice(start, end);

    expect(workspace).toContain("loading={loading}");
    expect(workspace).not.toContain("{loading ? (");
    expect(source).toContain(") : documents.length === 0 ? (");
  });
});
