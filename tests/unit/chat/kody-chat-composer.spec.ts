/**
 * Source-level structural test for the chat composer layout in
 * `KodyChat.tsx`. The composer is two distinct rows separated by a
 * hairline (issue #65):
 *
 *   Row A — input row:    [ Textarea (flex-1) ][ trailing send/stop icon button ]
 *   separator —           <div className="border-t …" />
 *   Row B — action row:   [ Paperclip ][ VoiceButton ][ spacer (flex-1) ]
 *
 * Per issue #131 the trailing-edge send/stop button lives INSIDE the
 * input row, not the action row. The trailing button is a single role
 * that swaps by state (issue #131 refinement):
 *   - Idle / no in-flight run  → <Send> paper-plane icon
 *   - In-flight run            → <Square> stop icon (replaces the old
 *                                 red `bg-destructive` Stop text button)
 *
 * The test reads the source file and asserts the structural markers so
 * the layout can never silently regress — either to the post-#65 split
 * (Send in the action row) or the original single-row layout.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/KodyChat.tsx",
);

/**
 * Count net `<div …>` opens minus `</div>` closes on a line. Split JSX
 * openings like `<div` count immediately; same-line self-closing
 * `<div …/>` are excluded so the hairline does not unbalance depth.
 */
function countDivs(line: string): { opens: number; closes: number } {
  const divStarts = (line.match(/<div\b/g) ?? []).length;
  const selfClosing = (line.match(/<div\b[^>]*\/>/g) ?? []).length;
  const opens = divStarts - selfClosing;
  const closes = (line.match(/<\/div>/g) ?? []).length;
  return { opens, closes };
}

/**
 * Find the line range of the composer container — the outermost
 * `<div className={...}>…</div>` whose classes include the composer
 * border and padding. The class may be a conditional template because
 * AI and terminal modes have different backgrounds, so scan a small
 * opening-tag window instead of matching one exact string.
 */
function findComposerBlockRange(lines: string[]): {
  start: number;
  end: number;
} {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const openingTag = lines.slice(i, i + 5).join("\n");
    if (
      lines[i].includes("<div") &&
      openingTag.includes("className=") &&
      openingTag.includes("border-t") &&
      openingTag.includes("px-1.5 py-2 sm:p-3")
    ) {
      start = i;
      break;
    }
  }
  expect(start, "composer container must exist").toBeGreaterThan(-1);

  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const { opens, closes } = countDivs(lines[i]);
    depth += opens - closes;
    if (depth === 0) {
      return { start, end: i };
    }
  }
  throw new Error("composer container never closed");
}

/**
 * Find the line range of the *Nth* flex row (i.e. Nth
 * `<div className="flex `) inside the given range, using the same
 * depth tracking.
 */
function findFlexRowRange(
  lines: string[],
  rangeStart: number,
  rangeEnd: number,
  occurrence: number,
): { start: number; end: number } {
  let count = 0;
  let rowStart = -1;
  for (let i = rangeStart; i <= rangeEnd; i++) {
    if (lines[i].includes('<div className="flex ')) {
      count += 1;
      if (count === occurrence) {
        rowStart = i;
        break;
      }
    }
  }
  expect(rowStart, `flex row #${occurrence} must exist`).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = rowStart; i <= rangeEnd; i++) {
    const { opens, closes } = countDivs(lines[i]);
    depth += opens - closes;
    if (depth === 0) {
      return { start: rowStart, end: i };
    }
  }
  throw new Error(`flex row #${occurrence} never closed`);
}

const SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");
const SOURCE_LINES = SOURCE.split("\n");
const COMPOSER_RANGE = findComposerBlockRange(SOURCE_LINES);
const COMPOSER_LINES = SOURCE_LINES.slice(
  COMPOSER_RANGE.start,
  COMPOSER_RANGE.end + 1,
);

describe("KodyChat composer — two-row layout (issue #65, #131)", () => {
  it("renders a hairline separator between the input row and the action row", () => {
    // A real divider element — not just whitespace. The token should
    // be a low-contrast border (border-border/40 or border-white/10).
    // The outer composer container already has a `border-t`, so we
    // exclude that line and look for a SECOND `border-t` (or a
    // `divide-y` / `border-t` on a child) that sits *between* the
    // input and action rows.
    const composerText = COMPOSER_LINES.join("\n");
    // The outer container's own `border-t` is on the opening tag.
    // The new internal hairline must be a *child* of that container.
    const internalBorderLines = COMPOSER_LINES.filter(
      (line) =>
        /\bborder-t\b/.test(line) && !line.includes("px-1.5 py-2 sm:p-3"),
    );
    const hasInternalHairline = internalBorderLines.length > 0;
    expect(
      hasInternalHairline,
      `composer must include a 1px hairline (border-t) between the input and action rows; outer container is not enough. composerText: ${composerText.slice(0, 200)}…`,
    ).toBe(true);
  });

  it("the input row (1st flex row) contains the textarea AND the trailing send/stop icon button", () => {
    // The input row is the FIRST `<div className="flex ` in the
    // composer. Per issue #131, the trailing-edge send/stop button
    // sits INSIDE the input row (not in the action row).
    const inputRow = findFlexRowRange(
      SOURCE_LINES,
      COMPOSER_RANGE.start,
      COMPOSER_RANGE.end,
      1,
    );
    const inputText = SOURCE_LINES.slice(inputRow.start, inputRow.end + 1).join(
      "\n",
    );

    expect(inputText).toContain("<textarea");
    // The trailing send/stop icon button lives in the input row.
    expect(
      inputText,
      "input row must contain <Send (the trailing send/stop button lives here, per issue #131)",
    ).toMatch(/<Send\b/);
    // Paperclip and VoiceButton live in the action row below.
    expect(
      inputText,
      "input row must NOT contain <Paperclip (it lives in the action row)",
    ).not.toContain("<Paperclip");
    expect(
      inputText,
      "input row must NOT contain <VoiceButton (it lives in the action row)",
    ).not.toMatch(/<VoiceButton\b/);
  });

  it("the action row (2nd flex row) contains Paperclip + VoiceButton, not the textarea and not Send", () => {
    // The action row is the SECOND `<div className="flex ` in the
    // composer. Per issue #131, the Send button moved OUT of the
    // action row and into the input row.
    const actionRow = findFlexRowRange(
      SOURCE_LINES,
      COMPOSER_RANGE.start,
      COMPOSER_RANGE.end,
      2,
    );
    const actionText = SOURCE_LINES.slice(
      actionRow.start,
      actionRow.end + 1,
    ).join("\n");

    expect(actionText).toContain("<Paperclip");
    expect(actionText).toMatch(/<VoiceButton\b/);
    // Send moved to the input row (issue #131).
    expect(
      actionText,
      "action row must NOT contain <Send (it lives in the input row as the trailing button, per issue #131)",
    ).not.toMatch(/<Send\b/);
    // The action row must NOT contain the textarea — that lives in
    // the input row above.
    expect(
      actionText,
      "action row must NOT contain <textarea (it lives in the input row)",
    ).not.toContain("<textarea");
  });

  it("the input row has no standalone red Stop text button — the trailing icon button is the only stop affordance (issue #131 refinement)", () => {
    // The refinement on issue #131 explicitly retires the red
    // `bg-destructive` Stop text button that used to sit in the input
    // row when loading. The new trailing send/stop icon button is
    // the only stop affordance while a run is active.
    const inputRow = findFlexRowRange(
      SOURCE_LINES,
      COMPOSER_RANGE.start,
      COMPOSER_RANGE.end,
      1,
    );
    const inputText = SOURCE_LINES.slice(inputRow.start, inputRow.end + 1).join(
      "\n",
    );
    // The old "Stop" button used the destructive red background.
    expect(
      inputText,
      "input row must NOT contain a red `bg-destructive` button (issue #131 retired the standalone red Stop text button)",
    ).not.toMatch(/<button[^>]*\bbg-destructive\b/);
    // The old "Stop" button also rendered literal "Stop" / "Cancel"
    // text. The new trailing button is icon-only — no text child.
    expect(
      inputText,
      "input row must NOT contain a literal '>Stop<' text button (the trailing button is icon-only)",
    ).not.toMatch(/>Stop</);
    expect(
      inputText,
      "input row must NOT contain a literal '>Cancel<' text button (the trailing button is icon-only)",
    ).not.toMatch(/>Cancel</);
  });

  it("the action row (2nd flex row) includes a reserved flex-1 spacer slot for future widget actions", () => {
    const actionRow = findFlexRowRange(
      SOURCE_LINES,
      COMPOSER_RANGE.start,
      COMPOSER_RANGE.end,
      2,
    );
    const actionText = SOURCE_LINES.slice(
      actionRow.start,
      actionRow.end + 1,
    ).join("\n");
    // A flex-1 div slot in the action row — an empty placeholder
    // for future widget actions (slash-command trigger, attachment
    // previews inline, mode toggles, etc.).
    expect(
      actionText,
      "action row must include a flex-1 reserved slot for future widgets",
    ).toMatch(/<div[^>]*\bclassName="[^"]*\bflex-1\b[^"]*"/);
  });

  it("preserves the autosize textarea behavior (inline onChange sets e.target.style.height)", () => {
    // Regression guard: the textarea must still grow vertically with
    // content. Issue #65 explicitly forbids changing autosize behavior.
    expect(COMPOSER_LINES.join("\n")).toContain(
      'e.target.style.height = "auto"',
    );
    expect(COMPOSER_LINES.join("\n")).toContain(
      "Math.min(e.target.scrollHeight, 150)",
    );
  });
});
