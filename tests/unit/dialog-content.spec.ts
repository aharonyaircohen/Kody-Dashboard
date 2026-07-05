import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/dashboard/ui/dialog.tsx", "utf8");

describe("DialogContent", () => {
  it("exposes reusable modal size and height variants", () => {
    expect(SOURCE).toContain('modalSize?: "default" | "wide"');
    expect(SOURCE).toContain('modalHeight?: "content" | "viewport"');
    expect(SOURCE).toContain("dialogSizeClass");
    expect(SOURCE).toContain("sm:w-[56rem]");
    expect(SOURCE).toContain("dialogHeightClass");
    expect(SOURCE).toContain("h-[calc(100vh-2rem)]");
    expect(SOURCE).toContain("grid-rows-[auto_minmax(0,1fr)]");
  });
});
