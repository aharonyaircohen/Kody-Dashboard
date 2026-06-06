/**
 * Source-level structural test for the chat composer layout in
 * `KodyChat.tsx`. The composer was restructured (issue #65) from a
 * single rounded flex row (Paperclip | Textarea | VoiceButton | Send)
 * to two distinct rows separated by a hairline:
 *
 *   Row A — input row:    [ Textarea (flex-1) ][ Send/Stop/Start ]
 *   separator —           <div className="border-t …" />
 *   Row B — action row:   [ Paperclip ][ VoiceButton ][ spacer (flex-1) ]
 *
 * Pure JSX layout refactor — no behavior change. The test reads the
 * source file and asserts the structural markers so the refactor can
 * never silently regress to the old single-row layout.
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
 * Count net `<div …>` opens minus `</div>` closes on a line. Self-
 * closing `<div …/>` are explicitly excluded so they don't unbalance
 * the depth counter (the new hairline is `<div …/>`).
 */
function countDivs(line: string): { opens: number; closes: number } {
  const opens = (line.match(/<div(?:\s[^/>]*)?>/g) ?? []).length;
  const closes = (line.match(/<\/div>/g) ?? []).length;
  return { opens, closes };
}

/**
 * Find the line range of the composer container — the outermost
 * `<div className="px-1.5 py-2 sm:p-3 border-t">…</div>`. The opening
 * and closing tags both have 6 leading spaces (indent 6), so we scan
 * forward from the opening, tracking net `<div` opens vs. `</div>`
 * closes, and stop when depth returns to 0.
 */
function findComposerBlockRange(lines: string[]): {
  start: number;
  end: number;
} {
  const startMarker = '<div className="px-1.5 py-2 sm:p-3 border-t">';
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(startMarker)) {
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

describe("KodyChat composer — two-row layout (issue #65)", () => {
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
        /\bborder-t\b/.test(line) &&
        !line.includes("px-1.5 py-2 sm:p-3 border-t"),
    );
    const hasInternalHairline = internalBorderLines.length > 0;
    expect(
      hasInternalHairline,
      `composer must include a 1px hairline (border-t) between the input and action rows; outer container is not enough. composerText: ${composerText.slice(0, 200)}…`,
    ).toBe(true);
  });

  it("the input row (1st flex row) contains the textarea + Send button, not Paperclip/VoiceButton", () => {
    // The input row is the FIRST `<div className="flex ` in the
    // composer. The old layout had a single row containing all four
    // children — this test pins the new layout.
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
    // Send button — the literal "Send" label, possibly with whitespace
    // between the text and the closing `</button>`.
    expect(inputText, "input row must contain the Send button").toMatch(
      />\s*Send\s*</,
    );
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

  it("the action row (2nd flex row) contains Paperclip + VoiceButton, not the textarea", () => {
    // The action row is the SECOND `<div className="flex ` in the
    // composer.
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
    // The action row must NOT contain the textarea — that lives in
    // the input row above.
    expect(
      actionText,
      "action row must NOT contain <textarea (it lives in the input row)",
    ).not.toContain("<textarea");
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
