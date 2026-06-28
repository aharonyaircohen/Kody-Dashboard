import { describe, expect, it } from "vitest";

import { resolveTextDirection } from "@dashboard/lib/text-direction";

describe("text direction helpers", () => {
  it("detects RTL titles from the first strong RTL character", () => {
    expect(resolveTextDirection("הכנה לכיתה ד - משימות לסיום")).toBe("rtl");
    expect(resolveTextDirection("15 משימות לסיום")).toBe("rtl");
  });

  it("keeps LTR titles LTR", () => {
    expect(resolveTextDirection("GitHub release tasks")).toBe("ltr");
  });

  it("falls back to automatic direction for neutral text", () => {
    expect(resolveTextDirection("123 - ...")).toBe("auto");
  });
});
