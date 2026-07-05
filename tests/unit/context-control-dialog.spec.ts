import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "src/dashboard/lib/components/ContextControl.tsx",
  "utf8",
);

describe("ContextControl entry dialogs", () => {
  it("uses the shared wide viewport modal behavior for create and edit", () => {
    const createDialog = SOURCE.slice(
      SOURCE.indexOf("function CreateEntryDialog"),
      SOURCE.indexOf("function EditEntryDialog"),
    );
    const editDialog = SOURCE.slice(
      SOURCE.indexOf("function EditEntryDialog"),
      SOURCE.indexOf("function EmptyState"),
    );

    for (const dialog of [createDialog, editDialog]) {
      expect(dialog).toContain('modalSize="wide"');
      expect(dialog).toContain('modalHeight="viewport"');
      expect(dialog).toContain(
        'className="mt-2 flex min-h-0 min-w-0 flex-col gap-4 overflow-visible"',
      );
      expect(dialog).not.toContain('className="max-w-2xl"');
    }
  });
});
