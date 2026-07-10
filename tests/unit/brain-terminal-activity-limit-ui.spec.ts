/**
 * @fileoverview Regression guard for Brain Fly suspension settings.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldSendBrainActivityLimit } from "@kody-chat/chat/plugins/terminal/fly-connection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_CARD_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/BrainFlyCard.tsx"),
  "utf8",
);

describe("Brain suspension UI", () => {
  it("offers idle auto-suspend and never for Brain Fly", () => {
    expect(BRAIN_CARD_SOURCE).toContain("brainSuspension");
    expect(BRAIN_CARD_SOURCE).toContain("Brain suspension");
    expect(BRAIN_CARD_SOURCE).toContain("When idle");
    expect(BRAIN_CARD_SOURCE).toContain("Never");
    expect(BRAIN_CARD_SOURCE).toContain('"x-kody-brain-suspension"');
  });

  it("applies the activity limit to Brain-featured terminal sessions", () => {
    // Behavior pin (was a ChatTerminalSurface source read pre-Step-5a):
    // Brain terminals — and Fly machines running the brain feature or with
    // no declared feature — receive the activity limit; runner machines
    // never do.
    expect(shouldSendBrainActivityLimit({ type: "brain" })).toBe(true);
    expect(
      shouldSendBrainActivityLimit({
        type: "fly",
        app: "brain-app",
        machineId: "m1",
        feature: "brain",
      }),
    ).toBe(true);
    expect(
      shouldSendBrainActivityLimit({
        type: "fly",
        app: "some-app",
        machineId: "m1",
      }),
    ).toBe(true);
    expect(
      shouldSendBrainActivityLimit({
        type: "fly",
        app: "runner-app",
        machineId: "m1",
        feature: "runner",
      }),
    ).toBe(false);
  });
});
