/**
 * @fileoverview Regression guard for Brain Fly suspension settings.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_CARD_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/BrainFlyCard.tsx"),
  "utf8",
);
const SURFACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/components/ChatTerminalSurface.tsx",
  ),
  "utf8",
);

describe("Brain suspension UI", () => {
  it("offers idle auto-suspend and never for Brain Fly", () => {
    expect(BRAIN_CARD_SOURCE).toContain("brainSuspension");
    expect(BRAIN_CARD_SOURCE).toContain("Brain suspension");
    expect(BRAIN_CARD_SOURCE).toContain("When idle");
    expect(BRAIN_CARD_SOURCE).toContain("Never");
    expect(BRAIN_CARD_SOURCE).toContain('"x-kody-brain-suspension"');
    expect(SURFACE_SOURCE).toContain('current.feature === "brain"');
  });
});
