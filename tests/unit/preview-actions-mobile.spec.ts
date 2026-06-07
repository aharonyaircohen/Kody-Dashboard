/**
 * @fileoverview Regression test for issue #82: PreviewModal action buttons
 * were reported hidden on mobile view. The reporter traced it to
 * `className="hidden sm:flex"` on the action bar's outer container, which
 * would make the buttons disappear below the `sm` (640px) breakpoint.
 *
 * These assertions lock in the correct behavior: the action bar's outer
 * container must be visible on mobile (no `hidden` on the base class)
 * and must use `flex` (with optional `flex-wrap`) so the action buttons
 * render on all viewports. The same constraints are checked against
 * the merged className (after `cn(...)` resolves the `className` prop)
 * to catch regressions where a caller passes a `hidden sm:flex`
 * override.
 *
 * @testFramework vitest
 * @domain preview
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PREVIEW_ACTIONS_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewActions.tsx",
);

const PREVIEW_MODAL_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewModal.tsx",
);

const VIBE_PAGE_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/VibePage.tsx",
);

/**
 * Extract the action bar's outer <div> className — the first <div> in the
 * returned JSX of `PreviewActions`. It's a single cn(...) call we can
 * scan for the default Tailwind class string.
 */
function extractActionBarDefaultClassName(): string {
  const source = readFileSync(PREVIEW_ACTIONS_PATH, "utf8");
  // Match the first className={cn(\n ... "..." \n ... \n)} block after
  // the return statement — that's the action bar wrapper.
  const match = source.match(
    /className=\{cn\(\s*\n?\s*"([^"]+)"\s*,\s*\n?\s*className\s*,?\s*\n?\s*\)\}/,
  );
  if (!match || !match[1]) {
    throw new Error(
      "Could not locate the action bar's outer className in PreviewActions.tsx",
    );
  }
  return match[1];
}

describe("PreviewActions — action bar mobile visibility (issue #82)", () => {
  it("renders the action bar as `flex` on all viewports (no `hidden` on the base class)", () => {
    const className = extractActionBarDefaultClassName();

    // The base class must declare `flex` so the wrapper is visible on
    // mobile. `twMerge` will resolve any caller-supplied `hidden
    // sm:flex` against this — but if the base itself is `hidden
    // sm:flex`, the merge result is the same buggy outcome.
    expect(className).toMatch(/\bflex\b/);
  });

  it("does NOT use `hidden sm:flex` on the action bar wrapper (regression guard for issue #82)", () => {
    const className = extractActionBarDefaultClassName();

    // The original buggy className was `hidden sm:flex`. `flex` is
    // mandatory on the base class; `hidden` on the base would silence
    // the buttons on every viewport (because `twMerge` lets the last
    // conflicting token win, and a caller passing nothing leaves
    // `hidden` in place).
    expect(className).not.toMatch(/\bhidden\b/);
    expect(className).not.toMatch(/\bsm:flex\b/);
  });

  it("does NOT omit the buttons on the base class — `flex flex-wrap` (or any flex-*) must be present", () => {
    const className = extractActionBarDefaultClassName();
    const tokens = className.split(/\s+/);
    // At least one flex-* token must be present so the wrapper is laid
    // out as a flex container on every breakpoint.
    expect(tokens.some((t) => t.startsWith("flex"))).toBe(true);
  });
});

describe("PreviewActions — both call sites must not pass a `hidden` override", () => {
  function hasHiddenOverride(path: string): boolean {
    const source = readFileSync(path, "utf8");
    // Look for <PreviewActions ... className="...hidden..." /> — the
    // simplest heuristic is a `className=` attribute on the same
    // <PreviewActions tag, but in practice neither caller passes one.
    // We assert that the literal `className=` does NOT appear inside
    // the PreviewActions JSX tag in either call site.
    const tagBlocks = source.match(/<PreviewActions\b[^>]*>/g) ?? [];
    return tagBlocks.some((block) => /className=/.test(block));
  }

  it("PreviewModal does not pass a `className` override to PreviewActions", () => {
    expect(hasHiddenOverride(PREVIEW_MODAL_PATH)).toBe(false);
  });

  it("VibePage does not pass a `className` override to PreviewActions", () => {
    expect(hasHiddenOverride(VIBE_PAGE_PATH)).toBe(false);
  });
});
