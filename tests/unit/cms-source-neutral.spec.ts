import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("CMS source-neutral boundaries", () => {
  it("keeps the Mongo schema generator free of app-specific defaults", () => {
    const source = readRepoFile("scripts/cms-adapters/mongodb/generate-schema.mjs");

    expect(source).not.toContain("COMMON_RELATIONS");
    expect(source).not.toContain("payload-jobs");
    expect(source).not.toContain("A-Guy-Web");
    expect(source).not.toContain("chapterLabel");
    expect(source).not.toContain("courseLabel");
  });
});
