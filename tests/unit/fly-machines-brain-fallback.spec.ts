/**
 * @fileoverview Regression guard for Fly Live machines showing Brain apps.
 * @testFramework vitest
 * @domain runner
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/fly/machines/route.ts"),
  "utf8",
);
const HELPER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/runners/fly-inventory-server.ts"),
  "utf8",
);

describe("Fly machines Brain fallback", () => {
  it("adds the saved Brain app directly when the normal inventory misses it", () => {
    expect(ROUTE_SOURCE).toContain("appendSavedBrainMachineToInventory");
    expect(HELPER_SOURCE).toContain("readBrainApp(");
    expect(HELPER_SOURCE).toContain("brainAppName(ctx.context.account)");
    expect(HELPER_SOURCE).toContain("listMachines(app");
    expect(HELPER_SOURCE).toContain("rowsForFlyApp(app, machines");
    expect(HELPER_SOURCE).toContain('feature: "brain"');
  });
});
