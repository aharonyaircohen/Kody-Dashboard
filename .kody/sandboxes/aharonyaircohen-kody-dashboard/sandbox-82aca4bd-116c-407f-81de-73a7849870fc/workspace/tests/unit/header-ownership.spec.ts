import { describe, expect, it } from "vitest";

import { routeOwnsAppHeader } from "@dashboard/lib/components/header-ownership";

describe("routeOwnsAppHeader", () => {
  it("treats task dashboard routes as owning their own header", () => {
    expect(routeOwnsAppHeader("/tasks")).toBe(true);
    expect(routeOwnsAppHeader("/tasks/")).toBe(true);
    expect(routeOwnsAppHeader("/new/")).toBe(true);
    expect(routeOwnsAppHeader("/bug/")).toBe(true);
    expect(routeOwnsAppHeader("/report-kody-bug/")).toBe(true);
  });

  it("treats numeric task routes as owning their own header", () => {
    expect(routeOwnsAppHeader("/123")).toBe(true);
    expect(routeOwnsAppHeader("/123/")).toBe(true);
    expect(routeOwnsAppHeader("/123/preview/comments")).toBe(true);
  });

  it("keeps the shared header for normal app routes", () => {
    expect(routeOwnsAppHeader("/")).toBe(false);
    expect(routeOwnsAppHeader("/inbox")).toBe(false);
    expect(routeOwnsAppHeader(null)).toBe(false);
  });
});
