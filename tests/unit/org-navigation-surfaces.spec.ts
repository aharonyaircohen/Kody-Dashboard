/**
 * Source-level structural tests for org navigation surfaces.
 *
 * These pin the product relationship: one org/workspace link is visible in the
 * dashboard side rail, and the org page itself has a change-organization
 * control sourced from the same connected repo registry.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../node_modules/@kody-ade/kody-chat/src/dashboard/lib/components/Sidebar.tsx"),
  "utf8",
);
const SETTINGS_NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/settings-nav.ts"),
  "utf8",
);
const ORG_MANAGER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/OrgManager.tsx"),
  "utf8",
);

describe("org navigation surfaces", () => {
  it("keeps one static org page in the dashboard side rail", () => {
    expect(SETTINGS_NAV_SOURCE).toMatch(/href: "\/org"/);
    expect(SETTINGS_NAV_SOURCE).toMatch(/label: "Org"/);
    expect(SETTINGS_NAV_SOURCE).toMatch(/navItemForHref\("\/org"\)/);
    expect(SIDEBAR_SOURCE).toMatch(/ENGINEER_MODE_SECTIONS/);
    expect(SIDEBAR_SOURCE).not.toMatch(/orgNavItems/);
    expect(SIDEBAR_SOURCE).not.toMatch(/title: "Organizations"/);
    expect(SIDEBAR_SOURCE).not.toMatch(
      /href: `\/org\/\$\{encodeURIComponent\(owner\)\}`/,
    );
  });

  it("lets the org page switch between connected owners", () => {
    expect(ORG_MANAGER_SOURCE).toMatch(/orgOwners/);
    expect(ORG_MANAGER_SOURCE).toMatch(/aria-label="Change organization"/);
    expect(ORG_MANAGER_SOURCE).toMatch(
      /router\.push\(`\/org\/\$\{encodeURIComponent/,
    );
  });
});
