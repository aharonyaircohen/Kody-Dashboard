import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/RunModeControl.tsx",
  "utf8",
);

describe("RunModeControl source", () => {
  it("keeps Auto / Manual as accessibility labels, not visible button text", () => {
    expect(source.match(/aria-label=\{modeLabel\(mode\)\}/g)?.length).toBe(2);
    expect(source).toContain('aria-label="Run Mode"');
    expect(source).not.toContain('{mode === "auto" ? "Auto" : "Manual"}');
    expect(source).not.toContain(">Run Mode<");
  });
});
