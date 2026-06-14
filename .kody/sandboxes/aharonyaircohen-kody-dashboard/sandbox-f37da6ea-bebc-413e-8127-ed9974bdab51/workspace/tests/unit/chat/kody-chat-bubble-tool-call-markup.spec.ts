/**
 * Source-level structural test for the assistant bubble renderer in
 * `KodyChat.tsx` (issue #130). The kody agents emit tool calls inline
 * in the model text stream — `<kody_run_issue />` and
 * `<tool_call>…</tool_call>` JSON blocks. The structured call is captured
 * separately as a `ToolCall` and rendered via `ThinkingPanel`; the raw
 * markup leaking into the visible bubble is just noise that the user
 * has to mentally filter out. The renderer also needs `remark-gfm` so
 * bare URLs in the reply get auto-linked.
 *
 * We assert the structural markers in the source so a future refactor
 * can't silently drop the stripping or the URL auto-link.
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

describe("KodyChat assistant bubble — tool-call XML + URL auto-link (issue #130)", () => {
  it("imports the tool-call stripper helper from the chat module", () => {
    // The bubble must use `parseAssistantContent` (which strips tool-call
    // markup from the visible answer). Without this import, the bubble
    // would fall back to `parseReasoning` and leak raw `<tool_name />`
    // tags into the user's view.
    expect(SOURCE).toMatch(
      /import\s*\{\s*parseAssistantContent\s*\}\s*from\s*["']\.\.\/chat\/tool-call-strip["']/,
    );
  });

  it("imports remark-gfm for bare-URL auto-linking", () => {
    // Without `remark-gfm`, ReactMarkdown renders bare URLs as plain
    // text — the user's reported "clicking does nothing" symptom. The
    // import must be present so the plugin is wired into the bubble.
    expect(SOURCE).toMatch(/import\s+remarkGfm\s+from\s+["']remark-gfm["']/);
  });

  it("passes remarkGfm to the assistant bubble's ReactMarkdown", () => {
    // The plugin must be passed via `remarkPlugins` on the bubble's
    // `<ReactMarkdown>` — not just imported and unused. A bare import
    // would still leave URLs unclickable.
    expect(SOURCE).toMatch(
      /<ReactMarkdown[\s\S]*?remarkPlugins=\{?\[\s*remarkGfm\s*\]/,
    );
  });

  it("routes the bubble's answer text through parseAssistantContent", () => {
    // The bubble must destructure `{ reasoning, answer }` from the
    // stripping parser, NOT from the raw `parseReasoning`. Stripping
    // in the wrong call site (e.g. only on the model-loop side) would
    // leave the visible bubble dirty.
    const bubbleBlock = SOURCE.match(
      /parseAssistantContent\(\s*msg\.content\s*\)/,
    );
    expect(
      bubbleBlock,
      "Bubble render must call parseAssistantContent(msg.content) to strip tool-call XML before markdown render",
    ).not.toBeNull();
  });

  it("opens bare links in a new tab and annotates the anchor for safety", () => {
    // The custom `a` component on the bubble must mirror the rest of
    // the dashboard (CommentList, MessagesView): `target="_blank"` +
    // `rel="noopener noreferrer"` so external links can't reach back
    // into the page via `window.opener`. Pinned here so a future
    // refactor to a shared `<MarkdownLink>` can't drop either.
    const aBlock = SOURCE.match(
      /a:\s*\(\{\s*href[\s\S]*?\}\s*\)\s*=>\s*\([\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"[\s\S]*?\)\s*,/,
    );
    expect(
      aBlock,
      "Bubble must provide a custom `a` component for ReactMarkdown that opens external links in a new tab",
    ).not.toBeNull();
  });
});
