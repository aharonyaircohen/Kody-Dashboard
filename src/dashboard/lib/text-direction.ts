/**
 * @fileType utility
 * @domain kody
 * @pattern text-direction
 * @ai-summary Helpers for rendering user-authored LTR/RTL text with natural direction.
 */

export type TextDirection = "auto" | "ltr" | "rtl";

export const textIsolationStyle = { unicodeBidi: "plaintext" } as const;
const rtlStrongCharacterPattern = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const ltrStrongCharacterPattern = /[A-Za-z\u00C0-\u024F\u0370-\u052F]/;

export function resolveTextDirection(text: string): TextDirection {
  for (const character of text.trim()) {
    if (rtlStrongCharacterPattern.test(character)) return "rtl";
    if (ltrStrongCharacterPattern.test(character)) return "ltr";
  }
  return "auto";
}

export function textDirectionProps(text: string): {
  dir: TextDirection;
  style: typeof textIsolationStyle;
} {
  return {
    dir: resolveTextDirection(text),
    style: textIsolationStyle,
  };
}

export const autoDirProps = {
  dir: "auto",
  style: textIsolationStyle,
} as const;

export const rtlAwareMarkdownClassName =
  "[&_ul]:ps-6 [&_ul]:pe-0 [&_ol]:ps-6 [&_ol]:pe-0 [&_blockquote]:border-l-0 [&_blockquote]:border-s-4 [&_blockquote]:ps-4 [&_blockquote]:pe-0 [&_th]:text-start [&_td]:text-start";
