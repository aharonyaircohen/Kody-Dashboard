/**
 * Source-level structural test for the slash-command submit path in
 * `KodyChat.tsx` (issue #140). Typing `/chat-review` (or any other
 * registered command) and pressing Enter must:
 *
 *   - Push a user bubble whose `content` is the **original** typed input
 *     (e.g. `/chat-review`), NOT the expanded command body.
 *   - Still ship the expanded prompt to the model so it sees the full
 *     command body on the wire.
 *
 * The chat composer already substitutes `$ARGUMENTS` into the command
 * body before the model sees anything — but the user bubble was
 * accidentally showing the expanded body too, contaminating the chat
 * history with text the user never typed.
 *
 * The fix routes the submit handler through a new `displayContent` option
 * on `sendText`: `messageContent` (what the model sees) is the expanded
 * body + context chips, `displayContent` (what the bubble shows) is the
 * raw input. We assert the structural markers in the source so a future
 * refactor can't silently regress the bubble.
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

const SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");

describe("KodyChat submit handler — slash command bubble text (issue #140)", () => {
  it("sendText accepts a displayContent option that overrides the bubble text", () => {
    // The fix routes through a new optional `displayContent` on sendText.
    // Without it, the user bubble would always mirror the model-facing
    // messageContent — which is the expanded prompt when a slash command
    // matches. The option must be present in the options type.
    expect(SOURCE).toMatch(/displayContent\?:\s*string\s*;/);
  });

  it("sendText defaults displayContent to messageContent when not provided", () => {
    // Backward compatibility: existing callers (voice, resume, hidden
    // preview-act follow-ups, …) must still see the same bubble text as
    // before. The fix must use `options.displayContent ?? messageContent`,
    // NOT `options.displayContent` (which would render an empty bubble
    // when the option is absent).
    expect(SOURCE).toMatch(
      /const\s+displayContent\s*=\s*options\.displayContent\s*\?\?\s*messageContent\s*;/,
    );
  });

  it("submit handler passes the original rawInput as displayContent when a slash command matches", () => {
    // The submit handler (inside the `sendMessage` function in
    // KodyChat.tsx) must branch on the `expanded` result and pass
    // `displayContent: rawInput` to sendText so the user bubble shows
    // only what was typed. The `userMessage` (built from `result.text`
    // + context chips) is still passed as the model-facing arg.
    //
    // The pattern we look for: a single sendText call that passes
    // `userMessage` as its first arg AND `displayContent: rawInput` in
    // the options object when `expanded` is truthy.
    const sendTextCall = SOURCE.match(
      /await\s+sendText\s*\(\s*[\s\S]*?userMessage\s*[\s\S]*?currentAttachments\s*[\s\S]*?expanded\s*\?\s*\{\s*displayContent:\s*rawInput\s*\}\s*:\s*undefined\s*,?[\s\S]*?\)\s*;/,
    );
    expect(
      sendTextCall,
      "submit handler must call sendText(userMessage, currentAttachments, expanded ? { displayContent: rawInput } : undefined) so the user bubble shows the original typed input, not the expanded prompt",
    ).not.toBeNull();
  });

  it("submit handler still routes the expanded prompt (not rawInput) to the model", () => {
    // The first arg to sendText must be `userMessage` (built from
    // `result.text` via `baseMessage`), not `rawInput`. If the submit
    // handler accidentally swapped them, the model would see the slash
    // form `/chat-review` and never the expanded body — silently
    // breaking every slash command.
    const sendTextCall = SOURCE.match(
      /await\s+sendText\s*\(\s*userMessage\s*,\s*currentAttachments/,
    );
    expect(
      sendTextCall,
      "submit handler must pass userMessage (built from result.text) — not rawInput — as the model-facing first arg to sendText",
    ).not.toBeNull();
  });

  it("submit handler builds the model-facing userMessage from the expanded text, not rawInput", () => {
    // The local `baseMessage` must select `expanded.text` when a command
    // matched, and only fall back to `rawInput` when there's no match.
    // This is the source of truth for what the model sees on the wire.
    const baseMessageDecl = SOURCE.match(
      /const\s+baseMessage\s*=\s*expanded\s*\?\s*expanded\.text\s*:\s*rawInput\s*;/,
    );
    expect(
      baseMessageDecl,
      "submit handler must compute baseMessage as `expanded ? expanded.text : rawInput` so the model receives the expanded prompt",
    ).not.toBeNull();
  });
});
