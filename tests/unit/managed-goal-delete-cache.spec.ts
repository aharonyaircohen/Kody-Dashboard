/**
 * @fileoverview Regression test for managed goal delete cache behavior.
 * @testFramework vitest
 * @domain goals
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/hooks/useManagedGoals.ts",
  "utf8",
);

describe("useDeleteManagedGoal cache behavior", () => {
  it("does not immediately refetch the deleted goal list", () => {
    const start = source.indexOf("export function useDeleteManagedGoal()");
    const end = source.indexOf("export function useRunManagedGoal()");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const deleteHook = source.slice(start, end);
    expect(deleteHook).not.toContain("invalidateQueries");
  });
});
