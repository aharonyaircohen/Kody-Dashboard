/**
 * Source-level structural test for issue #133: chat header "New
 * conversation" + sidebar "Chats" buttons must render as icons only,
 * matching the existing icon-only buttons in the chat header (collapse,
 * fullscreen) and the sidebar's close button.
 *
 * Three buttons are in scope:
 *   1. SessionSidebar.tsx — top-of-rail "+ New conversation" button.
 *      Must drop the text label and show a Plus icon.
 *   2. KodyChat.tsx — header "New conversation" button (added in PR #68).
 *      Same action, icon-only (Plus).
 *   3. KodyChat.tsx — header "Chats" button (MessageSquare icon, toggles
 *      the conversation list).
 *
 * The test reads each file as text and asserts JSX markers so the
 * refactor cannot silently regress to text labels. Pure structural
 * refactor — no behavior change, click handlers untouched.
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
const SESSION_SIDEBAR_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/SessionSidebar.tsx",
);

/**
 * Return the text content of the first `<button ...>...</button>` block
 * whose opening tag contains `marker`. Tracks JSX depth (open vs.
 * close) so nested tags don't terminate the match early. Whitespace
 * and JSX expression children are ignored — the function only walks
 * tag depth.
 */
function extractButtonBlock(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) {
    throw new Error(`button marker not found: ${marker}`);
  }
  // Walk back to the opening `<button` tag.
  const buttonStart = source.lastIndexOf("<button", idx);
  expect(buttonStart, `opening <button for marker ${marker}`).toBeGreaterThan(
    -1,
  );

  let depth = 0;
  let cursor = buttonStart;
  while (cursor < source.length) {
    const nextOpen = source.indexOf("<button", cursor + 1);
    const nextClose = source.indexOf("</button>", cursor + 1);
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      depth += 1;
      cursor = nextOpen;
      continue;
    }
    if (nextClose !== -1) {
      if (depth === 0) {
        return source.slice(buttonStart, nextClose + "</button>".length);
      }
      depth -= 1;
      cursor = nextClose;
      continue;
    }
    throw new Error(
      `unterminated button block for marker ${marker} (depth=${depth})`,
    );
  }
  throw new Error(`button block for marker ${marker} never closed`);
}

const KODY_CHAT_SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");
const SESSION_SIDEBAR_SOURCE = readFileSync(SESSION_SIDEBAR_PATH, "utf8");

describe("issue #133 — chat header / sidebar buttons are icon-only", () => {
  describe("KodyChat.tsx header", () => {
    const newConvButton = extractButtonBlock(
      KODY_CHAT_SOURCE,
      'aria-label="New conversation"',
    );
    const chatsButton = extractButtonBlock(
      KODY_CHAT_SOURCE,
      'aria-label="Toggle conversations"',
    );

    it('"New conversation" header button has a Plus icon, no text label', () => {
      // The icon-only pattern in this header (collapse, fullscreen) is
      // a `<LucideIcon />` child with no companion <span> or text.
      expect(
        /<Plus\b/.test(newConvButton),
        `"New conversation" button must render a Plus icon. block: ${newConvButton}`,
      ).toBe(true);
      expect(
        />New conversation</.test(newConvButton),
        `"New conversation" button must not render visible "New conversation" text. block: ${newConvButton}`,
      ).toBe(false);
    });

    it('"New conversation" header button keeps accessibility metadata', () => {
      // Tooltip + screen-reader label must survive the icon-only refactor.
      expect(newConvButton).toContain('aria-label="New conversation"');
      expect(newConvButton).toContain('title="Start a new conversation"');
    });

    it('"Chats" header button has a MessageSquare icon, no text label', () => {
      expect(
        /<MessageSquare\b/.test(chatsButton),
        `"Chats" button must render a MessageSquare icon. block: ${chatsButton}`,
      ).toBe(true);
      expect(
        />Chats</.test(chatsButton),
        `"Chats" button must not render visible "Chats" text. block: ${chatsButton}`,
      ).toBe(false);
    });

    it('"Chats" header button keeps accessibility metadata', () => {
      expect(chatsButton).toContain('aria-label="Toggle conversations"');
      expect(chatsButton).toContain('title="Conversations"');
    });
  });

  describe("SessionSidebar.tsx", () => {
    const newConvButton = extractButtonBlock(
      SESSION_SIDEBAR_SOURCE,
      "onClick={onCreateSession}",
    );

    it('"+ New conversation" button has a Plus icon, no text label', () => {
      expect(
        /<Plus\b/.test(newConvButton),
        `"+ New conversation" button must render a Plus icon. block: ${newConvButton}`,
      ).toBe(true);
      expect(
        />\+ New conversation</.test(newConvButton),
        `"+ New conversation" button must not render the literal text label. block: ${newConvButton}`,
      ).toBe(false);
    });

    it('"+ New conversation" button keeps accessibility metadata', () => {
      expect(newConvButton).toContain('aria-label="New conversation"');
      expect(newConvButton).toContain('title="New conversation"');
    });

    it('"Conversations" heading in the sidebar header is untouched', () => {
      // The issue explicitly excludes the sidebar heading.
      expect(SESSION_SIDEBAR_SOURCE).toContain(">Conversations<");
    });
  });
});
