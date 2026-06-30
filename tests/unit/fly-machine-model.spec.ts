/**
 * @fileoverview Regression coverage for Fly machine display labels.
 * @testFramework vitest
 * @domain runner
 */
import { describe, expect, it } from "vitest";

import {
  flyMachineTerminalLabel,
  flyTerminalTargetLabel,
  type FlyMachineRow,
} from "@dashboard/lib/runners/fly-machine-model";

describe("fly machine terminal labels", () => {
  it("uses one stable terminal name for Brain regardless of app label", () => {
    const brain = {
      feature: "brain",
      app: "brain-1",
      machineId: "185912dc627668",
      state: "started",
      region: "fra",
      label: "kody-brain-aguy",
      sizeLabel: "shared 2x",
    } satisfies FlyMachineRow;

    expect(flyMachineTerminalLabel(brain)).toBe("Brain server");
    expect(
      flyTerminalTargetLabel({
        feature: "brain",
        app: "brain-1",
        label: "brain-1",
      }),
    ).toBe("Brain server");
  });
});
