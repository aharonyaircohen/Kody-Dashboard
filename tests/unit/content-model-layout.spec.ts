import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("Content Model layout", () => {
  it("uses the builder layout instead of the old tabbed field cards", () => {
    const source = readRepoFile(
      "src/dashboard/lib/components/ContentModelManager.tsx",
    );

    expect(source).toContain("function ResourceSettingsBar");
    expect(source).toContain("function FieldsTable");
    expect(source).toContain("function FieldInspector");
    expect(source).toContain("<ResourcePreview draft={draft} />");
    expect(source).not.toContain("function ResourceFieldsEditor");
    expect(source).not.toContain('TabsTrigger value="preview"');
  });

  it("saves the latest dirty draft instead of a refetched resource snapshot", () => {
    const source = readRepoFile(
      "src/dashboard/lib/components/ContentModelManager.tsx",
    );

    expect(source).toContain("const draftRef = useRef(draft);");
    expect(source).toContain("draftRef.current = nextDraft;");
    expect(source).toContain(
      "if (draftDirty && draftSourceName === selectedCollection.name) return;",
    );
    expect(source).toContain("draft: draftRef.current");
    expect(source).toContain("onSuccess: async (cms, saved)");
    expect(source).not.toContain("saveMutation.mutate(draft)");
    expect(source).not.toContain("setSelectedName(draft.name.trim())");
  });
});
