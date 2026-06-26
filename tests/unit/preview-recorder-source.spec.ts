/**
 * Source-level guards for the extension macro recorder.
 *
 * @testFramework vitest
 * @domain preview-inspector
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../extension/src/content.js"),
  "utf8",
);
const PICKER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/picker/useElementPicker.ts"),
  "utf8",
);

describe("extension macro recorder", () => {
  it("persists in-flight recordings across preview navigations", () => {
    expect(CONTENT_SOURCE).toContain("__kody_recording_state_v1");
    expect(CONTENT_SOURCE).toContain("sessionStorage.setItem");
    expect(CONTENT_SOURCE).toContain("restoreRecording();");
    expect(CONTENT_SOURCE).toContain("requestId: msg.requestId");
  });

  it("does not let the first empty iframe reply discard recorded steps", () => {
    expect(PICKER_SOURCE).toContain("pickRecordingResult");
    expect(PICKER_SOURCE).toContain("data.requestId !== requestId");
    expect(PICKER_SOURCE).toContain("settle(best)");
  });
});
