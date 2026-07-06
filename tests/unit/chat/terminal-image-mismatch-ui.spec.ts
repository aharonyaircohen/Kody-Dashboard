/**
 * @fileoverview Source-level guard for Brain terminal image mismatch recovery.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SURFACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/components/ChatTerminalSurface.tsx",
  ),
  "utf8",
);
const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);

describe("Brain terminal image mismatch UI", () => {
  it("shows a non-blocking warning without adding a second apply action", () => {
    expect(SURFACE_SOURCE).toContain("selected_image_not_running");
    expect(SURFACE_SOURCE).toContain(
      "Selected image differs from running Brain",
    );
    expect(SURFACE_SOURCE).toContain("desiredImageRef?: string");
    expect(SURFACE_SOURCE).toContain("runningImageRef?: string | null");
    expect(SURFACE_SOURCE).toContain(
      "Terminal is connecting to the running Brain",
    );

    expect(SURFACE_SOURCE).not.toContain("Apply selected Brain image");
    expect(SURFACE_SOURCE).not.toContain("imageWarning?:");
    expect(SURFACE_SOURCE).not.toContain("Connecting to the active Brain machine");
    expect(CHAT_SOURCE).not.toContain("handleApplySelectedBrainImage");
    expect(CHAT_SOURCE).not.toContain("activeTerminalChrome?.recoveryAction");
    expect(CHAT_SOURCE).not.toContain("Apply selected Brain image");
  });
});
