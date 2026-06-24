/**
 * Source-level structural tests for OrgManager mobile layout.
 *
 * The repo intentionally does not carry DOM rendering helpers, so this guards
 * the CSS classes that keep long repository names from widening the viewport.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORG_MANAGER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/OrgManager.tsx"),
  "utf8",
);

describe("OrgManager mobile layout", () => {
  it("wraps long repository names instead of widening the mobile viewport", () => {
    expect(ORG_MANAGER_SOURCE).toMatch(/break-all text-sm font-medium/);
    expect(ORG_MANAGER_SOURCE).toMatch(/sm:truncate sm:break-normal/);
  });

  it("stacks available repository rows and attach action on mobile", () => {
    expect(ORG_MANAGER_SOURCE).toMatch(
      /flex flex-col gap-3 px-4 py-3 sm:flex-row/,
    );
    expect(ORG_MANAGER_SOURCE).toMatch(/className="w-full gap-2 sm:w-auto"/);
  });
});
