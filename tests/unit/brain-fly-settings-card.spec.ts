/**
 * @fileoverview Source-level regression guards for Settings -> Brain on Fly.
 * @testFramework vitest
 * @domain brain
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

describe("Brain on Fly settings card", () => {
  it("sends JSON and shows button-local progress while provisioning", () => {
    expect(BRAIN_CARD_SOURCE).toContain('"Content-Type": "application/json"');
    expect(BRAIN_CARD_SOURCE).toContain("Provision failed");
    expect(BRAIN_CARD_SOURCE).toContain("animate-spin");
  });

  it("does not add an extra empty-app explanation block", () => {
    expect(BRAIN_CARD_SOURCE).not.toContain("hasFlyAppWithoutMachine");
    expect(BRAIN_CARD_SOURCE).not.toContain(
      "Brain machine is running inside it",
    );
  });

  it("saves Brain suspension through the machine-config route", () => {
    const start = BRAIN_CARD_SOURCE.indexOf(
      "async function saveBrainSuspension",
    );
    const end = BRAIN_CARD_SOURCE.indexOf(
      "  // The dashboard has a stored record",
      start,
    );
    const saveBrainSuspension = BRAIN_CARD_SOURCE.slice(start, end);

    expect(saveBrainSuspension).toContain(
      '"/api/kody/brain/suspension"',
    );
    expect(saveBrainSuspension).not.toContain(
      '"/api/kody/brain/provision"',
    );
  });

  it("shows Fly authorization failures as token access problems", () => {
    expect(BRAIN_CARD_SOURCE).toContain('"fly_access_denied"');
    expect(BRAIN_CARD_SOURCE).toContain(
      "Fly token cannot access the stored Brain app",
    );
    expect(BRAIN_CARD_SOURCE).toContain(
      "Update\n                  the repo Fly token",
    );
  });
});
