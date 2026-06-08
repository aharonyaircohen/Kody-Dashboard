import { describe, expect, it } from "vitest";
import path from "path";
import {
  parseSafeFileStem,
  parseScenarioCategory,
  resolveUnderBase,
} from "@dashboard/lib/scenario-paths";

describe("scenario path guards", () => {
  it("accepts known scenario categories only", () => {
    expect(parseScenarioCategory("feature")).toBe("feature");
    expect(parseScenarioCategory("core")).toBe("core");
    expect(parseScenarioCategory("edge")).toBe("edge");
    expect(parseScenarioCategory("../../tmp")).toBeNull();
  });

  it("rejects traversal-like file stems", () => {
    expect(parseSafeFileStem("checkout-flow")).toBe("checkout-flow");
    expect(parseSafeFileStem("mockup.html")).toBe("mockup");
    expect(parseSafeFileStem("../mockup")).toBeNull();
    expect(parseSafeFileStem("mockup/evil")).toBeNull();
    expect(parseSafeFileStem(".env")).toBeNull();
  });

  it("keeps resolved paths inside the base directory", () => {
    const base = path.resolve("/tmp/kody-scenarios");

    expect(resolveUnderBase(base, "feature", "a.json")).toBe(
      path.join(base, "feature", "a.json"),
    );
    expect(resolveUnderBase(base, "..", "outside.json")).toBeNull();
  });
});
