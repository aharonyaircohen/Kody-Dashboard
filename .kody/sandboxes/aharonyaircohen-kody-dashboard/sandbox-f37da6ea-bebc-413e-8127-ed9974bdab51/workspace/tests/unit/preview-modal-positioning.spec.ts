/**
 * Source-level structural test for PreviewModal positioning (issue #110).
 *
 * The bug: clicking "Preview" on a task opened a full-screen `fixed
 * inset-0 z-50` overlay, covering the sidebar and the persistent chat
 * rail. Expected: preview opens as an in-page panel that sits next to
 * the sidebar and the chat rail, all three visible at once.
 *
 * The fix is a layout refactor: the modal's outermost container must
 * no longer use `fixed inset-0`, and the body (chat panel + main
 * column) no longer renders its own chat panel — the chat rail is
 * already mounted by ChatRailShell and pushed into scope for the
 * selected task, so the inner panel was both redundant and the
 * reason the modal had to be `fixed` (it would otherwise overflow
 * the page).
 *
 * Pure JSX layout test — no behavior change. The test reads the
 * source file and asserts the structural markers so the regression
 * cannot silently come back.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_MODAL_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewModal.tsx",
);

const SOURCE = readFileSync(PREVIEW_MODAL_PATH, "utf8");
const SOURCE_LINES = SOURCE.split("\n");

/**
 * Count net `<div …>` opens minus `</div>` closes on a line. Self-
 * closing `<div …/>` are explicitly excluded so they don't unbalance
 * the depth counter.
 */
function countDivs(line: string): { opens: number; closes: number } {
  const opens = (line.match(/<div(?:\s[^/>]*)?>/g) ?? []).length;
  const closes = (line.match(/<\/div>/g) ?? []).length;
  return { opens, closes };
}

/**
 * The PreviewModal has TWO return statements:
 *   1. early `if (!pr)` return — a small empty-state container
 *   2. the main render — the full modal UI
 *
 * The first return is at a deeper indent than the second (it's
 * inside an `if` block, so 6 spaces, vs. 4 for the main return).
 * We pick the outermost return (lowest indent) — that's the one
 * users see 99% of the time.
 */
function findMainReturnRange(lines: string[]): { start: number; end: number } {
  // The main return's outer div opens with the lowest indentation
  // of any `<div className=` on a `return (` line. Scan all
  // `return (` lines and find the one whose following `<div` line
  // has the smallest leading whitespace.
  const candidates: { line: number; indent: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*return \(/.test(lines[i])) continue;
    // Find the first opening tag after this return.
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const m = lines[j].match(/^(\s*)<[A-Za-z]/);
      if (m) {
        candidates.push({ line: j, indent: m[1]!.length });
        break;
      }
    }
  }
  expect(
    candidates.length,
    "PreviewModal must have at least one `return (` statement",
  ).toBeGreaterThan(0);
  // The main render is the one with the smallest indent.
  const main = candidates.reduce((a, b) => (a.indent <= b.indent ? a : b));
  const start = main.line;

  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const { opens, closes } = countDivs(lines[i]);
    depth += opens - closes;
    if (depth === 0) {
      return { start, end: i };
    }
  }
  throw new Error("main return never closed");
}

const MAIN_RANGE = findMainReturnRange(SOURCE_LINES);
const MAIN_LINES = SOURCE_LINES.slice(MAIN_RANGE.start, MAIN_RANGE.end + 1);
const OUTER_CLASS_LINE = MAIN_LINES[0] ?? "";

describe("PreviewModal — in-page panel positioning (issue #110)", () => {
  it("main render's outer container is NOT a full-screen fixed overlay", () => {
    // The bug used `fixed inset-0 z-50` which covered the sidebar and
    // chat rail. After the fix the modal sits in normal flow next to
    // them, so the outer container must not be `fixed` or `inset-0`.
    expect(OUTER_CLASS_LINE, "outer container line must exist").toMatch(
      /^(\s*)<div className="/,
    );
    const className = (OUTER_CLASS_LINE.match(/className="([^"]+)"/) ?? [
      ,
      "",
    ])[1]!;
    expect(
      className,
      "outer container must not be `fixed` (would cover the chat rail + sidebar)",
    ).not.toMatch(/\bfixed\b/);
    expect(
      className,
      "outer container must not be `inset-0` (would cover the chat rail + sidebar)",
    ).not.toMatch(/\binset-0\b/);
  });

  it("main render's outer container is a flex column that fills its parent", () => {
    // The modal now sits inside the page's main content area, so it
    // must be a flex column that takes 100% of the available space.
    const className = (OUTER_CLASS_LINE.match(/className="([^"]+)"/) ?? [
      ,
      "",
    ])[1]!;
    expect(className, "outer container must be `flex flex-col`").toMatch(
      /\bflex\b/,
    );
    expect(className, "outer container must be `flex flex-col`").toMatch(
      /\bflex-col\b/,
    );
    expect(
      className,
      "outer container must fill its parent's height/width",
    ).toMatch(/\bh-full\b/);
    expect(
      className,
      "outer container must fill its parent's height/width",
    ).toMatch(/\bw-full\b/);
  });

  it("main render does NOT mount a duplicate chat panel", () => {
    // The chat rail (rendered by ChatRailShell) is already pushed into
    // scope for the selected task, so the modal's inner chat panel was
    // redundant. The bug is what forced it to coexist (the full-screen
    // overlay hid the rail); now that the modal sits next to the rail
    // the inner panel would just duplicate it.
    const mainText = MAIN_LINES.join("\n");
    expect(
      mainText,
      "PreviewModal must not render its own <KodyChat> — the persistent chat rail is already scoped to the selected task",
    ).not.toMatch(/<KodyChat\b/);
  });
});
