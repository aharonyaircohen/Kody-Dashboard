import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readComponent = (name: string) =>
  readFileSync(
    join(process.cwd(), "src/dashboard/lib/components", name),
    "utf8",
  );

describe("preview branch URL resolution", () => {
  it("only opens branch previews once status returns a live signed URL", () => {
    for (const file of ["PreviewWorkspace.tsx", "VibePage.tsx"]) {
      const source = readComponent(file);

      expect(source, file).toContain("fetchBranchPreviews");
      expect(source, file).toContain("branchPreviewNeedsPoll");
      expect(source, file).toContain("BRANCH_PREVIEW_POLL_MS");
      expect(source, file).not.toContain("mintBranchPreviewUrl");
      expect(source, file).not.toContain("kody-branch-preview-ticket");
      expect(source, file).toMatch(
        /refetchInterval:\s*\(query\)\s*=>[\s\S]*branchPreviewNeedsPoll/,
      );
      expect(source, file).toMatch(
        /\? \(resolvedBranchPreview\?\.url \?\? null\)/,
      );
    }
  });
});
