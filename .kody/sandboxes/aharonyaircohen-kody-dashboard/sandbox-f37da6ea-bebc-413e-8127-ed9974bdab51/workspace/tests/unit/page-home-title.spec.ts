/**
 * Source-level structural test for issue #146: browser tab on / shows
 * "Kody Operations Dashboard" twice (page title + layout template suffix).
 *
 * Root cause: app/page.tsx set metadata.title = "Kody Operations Dashboard",
 * the same string as the layout's title.default. When the layout's
 * title.template ("%s | Kody Operations") is applied to a page title
 * that is already the full site name, the rendered tab title reads as
 * "Kody Operations Dashboard | Kody Operations" - the site name appears
 * once as a full phrase and again as a shorter variant, which is the
 * redundant "X | X" form the issue reports. (An older state of the
 * layout used a longer template suffix that produced exact duplicate
 * phrases.)
 *
 * The fix is to set the home page's title to a page-specific value
 * (e.g. "Happening now") so the rendered tab title has the site name
 * exactly once. This mirrors the convention every other page in the
 * app router (app/.../page.tsx) already follows ("Tasks - Kody
 * Operations Dashboard", "Vibe - Kody", "Chat - Kody Operations
 * Dashboard", ...).
 *
 * We assert the structural markers in the source so a future refactor
 * can't silently regress to the duplicated form.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYOUT_PATH = resolve(__dirname, "../../app/layout.tsx");
const PAGE_PATH = resolve(__dirname, "../../app/page.tsx");
const METADATA_PATH = resolve(__dirname, "../../app/metadata.ts");

const LAYOUT_SOURCE = readFileSync(LAYOUT_PATH, "utf8");
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");
const METADATA_SOURCE = readFileSync(METADATA_PATH, "utf8");

const SITE_NAME = "Kody Operations Dashboard";

/**
 * Extract the literal default and template from metadata.title in the
 * layout. Returns null if the layout doesn't have a string default +
 * template pair (e.g. someone swapped it for title.absolute).
 */
function extractLayoutTitle(): { default: string; template: string } | null {
  const match = LAYOUT_SOURCE.match(
    /title:\s*\{\s*default:\s*"([^"]+)"\s*,\s*template:\s*"([^"]+)"\s*,?\s*\}\s*,/,
  );
  if (!match) return null;
  return { default: match[1], template: match[2] };
}

/**
 * Extract the first title: "..." string literal from a page source.
 * Next.js applies a layout's title.template to a string page title by
 * simple %s substitution, so this is enough to render the browser tab
 * title in the test.
 */
function extractPageTitle(source: string): string | null {
  const match = source.match(/title:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Apply a Next.js title template to a page title. Mirrors the simple
 * %s substitution Next.js does for string page titles.
 */
function renderTabTitle(
  pageTitle: string,
  layoutTitle: { default: string; template: string },
): string {
  return layoutTitle.template.replace("%s", pageTitle);
}

describe("home page tab title (issue #146)", () => {
  it("layout exports a default and a template title", () => {
    const layout = extractLayoutTitle();
    expect(
      layout,
      "app/layout.tsx must export a metadata.title object with both default and template keys",
    ).not.toBeNull();
    expect(layout!.default).toBe(SITE_NAME);
    expect(layout!.template).toMatch(/%s/);
  });

  it("home page title is a page-specific name, not the full site name", () => {
    // The fix: app/page.tsx no longer sets the page title to the full
    // site name, which the layout's template would then duplicate (or
    // re-suffix with a shorter variant) in the browser tab. The page
    // should use a short, page-specific label like "Happening now" -
    // matching the convention every other page in the app router
    // (app/.../page.tsx) already follows ("Tasks - Kody Operations
    // Dashboard", "Vibe - Kody", ...).
    const pageTitle = extractPageTitle(PAGE_SOURCE);
    expect(
      pageTitle,
      "app/page.tsx must set a string title via buildKodyMetadata({ title: ... })",
    ).not.toBeNull();
    expect(
      pageTitle,
      `app/page.tsx title must not be the full site name "${SITE_NAME}" (it would be duplicated by the layout's template suffix)`,
    ).not.toBe(SITE_NAME);
  });

  it("rendered home page tab title does not duplicate the site name", () => {
    // End-to-end: the browser tab title on / is the layout template
    // applied to the page's title. With the bug, the page title was
    // the full site name, so the rendered tab contained the site name
    // twice (in full or in part). The fix changes the page title so
    // the rendered title has the site name exactly once.
    const layout = extractLayoutTitle();
    expect(layout, "layout title config must be present").not.toBeNull();
    const pageTitle = extractPageTitle(PAGE_SOURCE);
    expect(pageTitle, "home page must set a string title").not.toBeNull();
    const rendered = renderTabTitle(pageTitle!, layout!);
    const occurrences = rendered.split(SITE_NAME).length - 1;
    expect(
      occurrences,
      `rendered tab title "${rendered}" must contain "${SITE_NAME}" at most once (got ${occurrences})`,
    ).toBeLessThanOrEqual(1);
  });

  it("metadata.ts SITE_NAME constant matches the layout title default", () => {
    // app/metadata.ts and app/layout.tsx must agree on the site name,
    // so the openGraph siteName (used by social cards) matches the
    // title config. A drift between these two would be its own bug.
    const layout = extractLayoutTitle();
    expect(layout, "layout title config must be present").not.toBeNull();
    const metaMatch = METADATA_SOURCE.match(/SITE_NAME\s*=\s*"([^"]+)"/);
    expect(metaMatch, "metadata.ts must define SITE_NAME").not.toBeNull();
    expect(metaMatch![1]).toBe(layout!.default);
  });
});
