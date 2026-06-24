/**
 * @fileoverview Regression guard for Brain Fly terminal activity settings.
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

describe("Brain terminal activity limit UI", () => {
  it("offers minutes, hours, and never for Brain Fly terminals", () => {
    expect(BRAIN_CARD_SOURCE).toContain("brainTerminalActivityLimit");
    expect(BRAIN_CARD_SOURCE).toContain("Brain terminal activity");
    expect(BRAIN_CARD_SOURCE).toContain("30 min");
    expect(BRAIN_CARD_SOURCE).toContain("1 hour");
    expect(BRAIN_CARD_SOURCE).toContain("4 hours");
    expect(BRAIN_CARD_SOURCE).toContain("12 hours");
    expect(BRAIN_CARD_SOURCE).toContain("Never");
    expect(SURFACE_SOURCE).toContain("getStoredBrainTerminalActivityLimit()");
    expect(SURFACE_SOURCE).toContain('current.feature === "brain"');
  });
});
