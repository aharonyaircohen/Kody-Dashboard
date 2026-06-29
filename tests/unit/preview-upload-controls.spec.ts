/**
 * Source-level structural tests for Preview upload controls.
 *
 * The dashboard runs Vitest in node mode and does not include happy-dom /
 * @testing-library/react, so this follows the existing component structural-test
 * pattern.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_WORKSPACE_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewWorkspace.tsx",
);
const PREVIEW_ENV_SWITCHER_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewEnvSwitcher.tsx",
);
const PREVIEW_UPLOAD_BUTTON_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewFileUploadButton.tsx",
);
const WORKSPACE_SOURCE = readFileSync(PREVIEW_WORKSPACE_PATH, "utf8");
const SWITCHER_SOURCE = readFileSync(PREVIEW_ENV_SWITCHER_PATH, "utf8");
const UPLOAD_BUTTON_SOURCE = readFileSync(PREVIEW_UPLOAD_BUTTON_PATH, "utf8");

describe("Preview upload controls", () => {
  it("opens uploads through the shared native picker trigger", () => {
    expect(WORKSPACE_SOURCE).toMatch(/<PreviewFileUploadButton/);
    expect(SWITCHER_SOURCE).toMatch(/<PreviewFileUploadButton/);
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/type="file"/);
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/showOpenFilePicker/);
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/openFallbackInput/);
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/<button/);
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/className="hidden"/);
    expect(UPLOAD_BUTTON_SOURCE).not.toMatch(/opacity-0/);
  });

  it("clears the file input after each selection", () => {
    expect(UPLOAD_BUTTON_SOURCE).toMatch(/event\.currentTarget\.value = ""/);
  });

  it("keeps a just-uploaded environment selected while config catches up", () => {
    expect(WORKSPACE_SOURCE).toMatch(/pendingSelectionRef/);
    expect(WORKSPACE_SOURCE).toMatch(/selectedId !== pendingSelectedId/);
    expect(WORKSPACE_SOURCE).toMatch(
      /selectionPath\("\/preview", pendingSelectedId\)/,
    );
    expect(WORKSPACE_SOURCE).toMatch(/pendingSelectionRef\.current = env\.id/);
  });
});
