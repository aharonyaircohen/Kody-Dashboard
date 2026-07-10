import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readSidebar(): string {
  return readFileSync(
    resolve(root, "node_modules/@kody-ade/kody-chat/src/dashboard/lib/components/Sidebar.tsx"),
    "utf8",
  );
}

describe("sidebar scrolling", () => {
  it("keeps Home and Search outside the scrollable navigation list", () => {
    const source = readSidebar();
    const fixedStart = source.indexOf('data-sidebar-fixed-controls="true"');
    const fixedEnd = source.indexOf('data-sidebar-scroll-list="true"');
    const scrollEnd = source.indexOf("</nav>", fixedEnd);

    expect(fixedStart).toBeGreaterThan(-1);
    expect(fixedEnd).toBeGreaterThan(fixedStart);
    expect(scrollEnd).toBeGreaterThan(fixedEnd);

    const fixedControls = source.slice(fixedStart, fixedEnd);
    const scrollList = source.slice(fixedEnd, scrollEnd);

    // The pinned item defaults to DASHBOARD_NAV_ITEM (host-overridable).
    expect(fixedControls).toContain("renderLink(pinnedItem)");
    expect(fixedControls).toContain('aria-label="Search navigation"');
    expect(fixedControls).not.toContain("overflow-y-auto");
    expect(scrollList).toContain("overflow-y-auto");
    expect(scrollList).toContain("filteredSections.map");
  });
});
