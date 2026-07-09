import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/CapabilitiesManager.tsx",
  "utf8",
);

describe("CapabilitiesManager trust control", () => {
  it("does not expose runnable trust on capability details", () => {
    expect(source).not.toContain("TrustLevelControl");
    expect(source).not.toContain("trustLevelForCapability");
    expect(source).not.toContain('trustSubjectKey("capability"');
    expect(source).not.toContain("trust.setTrustLevel");
    expect(source).not.toContain("capability: selected.slug");
  });
});
