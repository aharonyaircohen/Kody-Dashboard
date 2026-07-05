import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "src/dashboard/lib/components/ModelsManager.tsx",
  "utf8",
);

describe("ModelsManager model editor dialog", () => {
  it("uses the shared wide viewport modal behavior", () => {
    const editorDialog = SOURCE.slice(
      SOURCE.indexOf("function ModelEditor"),
      SOURCE.length,
    );

    expect(editorDialog).toContain('modalSize="wide"');
    expect(editorDialog).toContain('modalHeight="viewport"');
    expect(editorDialog).toContain(
      'className="mt-2 flex min-h-0 min-w-0 flex-col gap-3 overflow-visible"',
    );
    expect(editorDialog).not.toContain('className="max-w-md"');
  });
});
