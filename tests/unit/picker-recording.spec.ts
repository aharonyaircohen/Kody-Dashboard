/**
 * Unit tests for preview recording result selection.
 *
 * @testFramework vitest
 * @domain preview-inspector
 */

import { describe, expect, it } from "vitest";
import {
  hasRecordedSteps,
  pickRecordingResult,
  type RecordingResult,
} from "@dashboard/lib/picker/recording";

describe("pickRecordingResult", () => {
  const empty: RecordingResult = { steps: [], url: "https://preview.test/a" };
  const withSteps: RecordingResult = {
    steps: [{ type: "click", selector: "#save" }],
    url: "https://preview.test/b",
  };

  it("keeps a later non-empty frame reply over an earlier empty one", () => {
    expect(pickRecordingResult(empty, withSteps)).toBe(withSteps);
  });

  it("keeps the recording with more steps", () => {
    const longer: RecordingResult = {
      steps: [
        { type: "click", selector: "#email" },
        { type: "fill", selector: "#email", value: "a@b.com" },
      ],
      url: "https://preview.test/login",
    };
    expect(pickRecordingResult(withSteps, longer)).toBe(longer);
  });

  it("treats empty recordings as not saveable", () => {
    expect(hasRecordedSteps(empty)).toBe(false);
    expect(hasRecordedSteps(withSteps)).toBe(true);
  });
});
