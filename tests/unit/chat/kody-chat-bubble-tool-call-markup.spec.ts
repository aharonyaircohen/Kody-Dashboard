/**
 * Source-level structural test for chat bubble Markdown rendering.
 *
 * Kody agents can emit raw tool-call XML in the model text stream. KodyChat
 * must strip that noise before rendering assistant text. User-authored
 * Markdown should also render through MarkdownPreview so composer preview,
 * user bubbles, and assistant bubbles share the same formatting path.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/KodyChat.tsx",
);
const MARKDOWN_PREVIEW_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/MarkdownPreview.tsx",
);

const KODY_CHAT_SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");
const MARKDOWN_PREVIEW_SOURCE = readFileSync(MARKDOWN_PREVIEW_PATH, "utf8");

describe("KodyChat bubble markdown contract", () => {
  it("strips tool-call markup before rendering assistant text", () => {
    expect(KODY_CHAT_SOURCE).toMatch(
      /import\s*\{\s*parseAssistantContent\s*\}\s*from\s*["']\.\.\/chat\/core\/tool-call-strip["']/,
    );
    expect(KODY_CHAT_SOURCE).toMatch(
      /parseAssistantContent\(\s*msg\.content\s*\)/,
    );
    expect(KODY_CHAT_SOURCE).toMatch(
      /const\s+\{\s*reasoning,\s*answer\s*\}\s*=\s*parsedAssistant/,
    );
  });

  it("delegates assistant markdown rendering to MarkdownPreview", () => {
    expect(KODY_CHAT_SOURCE).toMatch(
      /import\s*\{\s*MarkdownPreview\s*\}\s*from\s*["']\.\/MarkdownPreview["']/,
    );
    expect(KODY_CHAT_SOURCE).toMatch(
      /<MarkdownPreview[\s\S]*?content=\{answer\}/,
    );
  });

  it("delegates user markdown rendering to MarkdownPreview", () => {
    expect(KODY_CHAT_SOURCE).toMatch(
      /<MarkdownPreview[\s\S]*?content=\{softFormatUserMessageForDisplay\(\s*msg\.content,\s*\)\}[\s\S]*?variant="compact"[\s\S]*?prose-p:text-primary-foreground/,
    );
    expect(KODY_CHAT_SOURCE).toContain("prose-p:my-0");
    expect(KODY_CHAT_SOURCE).toContain("prose-p:whitespace-pre-wrap");
  });

  it("keeps bare-url linking and safe external links in MarkdownPreview", () => {
    expect(MARKDOWN_PREVIEW_SOURCE).toMatch(
      /import\s+remarkGfm\s+from\s+["']remark-gfm["']/,
    );
    expect(MARKDOWN_PREVIEW_SOURCE).toMatch(
      /<ReactMarkdown[\s\S]*?remarkPlugins=\{?\[\s*remarkGfm\s*\]/,
    );

    const anchorStart = MARKDOWN_PREVIEW_SOURCE.indexOf("a: ({ href");
    const anchorEnd = MARKDOWN_PREVIEW_SOURCE.indexOf(
      "blockquote:",
      anchorStart,
    );
    const anchorComponent =
      anchorStart >= 0 && anchorEnd > anchorStart
        ? MARKDOWN_PREVIEW_SOURCE.slice(anchorStart, anchorEnd)
        : "";
    expect(anchorComponent).not.toBe("");
    expect(anchorComponent).toContain(
      'target={isHashLink ? undefined : "_blank"}',
    );
    expect(anchorComponent).toContain(
      'rel={isHashLink ? undefined : "noopener noreferrer"}',
    );
  });
});
