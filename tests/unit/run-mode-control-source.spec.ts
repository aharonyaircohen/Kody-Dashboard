import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/RunModeControl.tsx",
  "utf8",
);

describe("RunModeControl source", () => {
  it("uses clear accessibility labels without visible button text", () => {
    expect(source).toContain("Human approval required");
    expect(source).toContain("Kody can trigger");
    expect(source).not.toContain("Autorun");
    expect(source).not.toContain("Run without approval");
  });
});
