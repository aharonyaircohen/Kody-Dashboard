import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VARIABLES_SOURCE = readFileSync(
  "src/dashboard/lib/components/VariablesManager.tsx",
  "utf8",
);
const SECRETS_SOURCE = readFileSync(
  "src/dashboard/lib/components/SecretsManager.tsx",
  "utf8",
);

describe("Variables and secrets editor dialogs", () => {
  it("uses the shared wide viewport modal behavior for variables", () => {
    const editorDialog = VARIABLES_SOURCE.slice(
      VARIABLES_SOURCE.indexOf("function VariableEditor"),
      VARIABLES_SOURCE.length,
    );

    expect(editorDialog).toContain('modalSize="wide"');
    expect(editorDialog).toContain('modalHeight="viewport"');
    expect(editorDialog).toContain(
      'className="mt-2 flex min-h-0 min-w-0 flex-col gap-3 overflow-visible"',
    );
    expect(editorDialog).not.toContain('className="max-w-md"');
  });

  it("uses the shared wide viewport modal behavior for secrets", () => {
    const editorDialog = SECRETS_SOURCE.slice(
      SECRETS_SOURCE.indexOf("function SecretEditor"),
      SECRETS_SOURCE.length,
    );

    expect(editorDialog).toContain('modalSize="wide"');
    expect(editorDialog).toContain('modalHeight="viewport"');
    expect(editorDialog).toContain(
      'className="mt-2 flex min-h-0 min-w-0 flex-col gap-3 overflow-visible"',
    );
    expect(editorDialog).not.toContain('className="max-w-md"');
  });
});
