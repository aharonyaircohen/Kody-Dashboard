import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/TrustLevelControl.tsx",
  "utf8",
);
describe("TrustLevelControl source", () => {
  it("uses one icon button for the three runnable trust states", () => {
    expect(source).toContain("Require approval");
    expect(source).toContain("Kody can run");
    expect(source).toContain("Auto approval");
    expect(source).toContain("data-trust-level={current.value}");
    expect(source).toContain("onChange(next.value)");
    expect(source).not.toContain("Kody can trigger");
    expect(source).not.toContain("Run without approval");
  });

  it("colors require/can-run/auto states red, amber, and green", () => {
    expect(source).toContain("bg-red-500/15");
    expect(source).toContain("text-red-300");
    expect(source).toContain("bg-amber-500/15");
    expect(source).toContain("text-amber-300");
    expect(source).toContain("bg-emerald-500/15");
    expect(source).toContain("text-emerald-300");
    expect(source).toContain('className="sr-only"');
  });
});
