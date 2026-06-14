/**
 * @fileType utility
 * @domain kody
 * @pattern text-direction
 * @ai-summary Helpers for rendering user-authored LTR/RTL text with natural direction.
 */

export const autoDirProps = {
  dir: "auto",
  style: { unicodeBidi: "plaintext" },
} as const;

export const rtlAwareMarkdownClassName =
  "[&_ul]:ps-6 [&_ul]:pe-0 [&_ol]:ps-6 [&_ol]:pe-0 [&_blockquote]:border-l-0 [&_blockquote]:border-s-4 [&_blockquote]:ps-4 [&_blockquote]:pe-0 [&_th]:text-start [&_td]:text-start";
