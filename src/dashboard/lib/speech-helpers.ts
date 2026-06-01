/**
 * Strip markdown formatting from text for TTS
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s/gm, "")
    .replace(/^\s*\d+\.\s/gm, "")
    .replace(/>\s/g, "")
    .trim();
}

/**
 * Detect language from text content
 */
export function detectLanguage(text: string): "he" | "en" {
  const hebrewRegex = /[\u0590-\u05FF]/;
  const hebrewCount = (text.match(hebrewRegex) || []).length;
  return hebrewCount > text.length * 0.3 ? "he" : "en";
}

/**
 * Pull complete sentences out of a (growing) text buffer for incremental
 * TTS. A boundary is sentence punctuation (. ! ? \u2026) followed by whitespace
 * or end-of-string, or a newline \u2014 the "followed by whitespace" guard keeps
 * "v1.2" or "3.5" from splitting mid-number.
 *
 * Returns the complete sentences found and `consumed` \u2014 the number of
 * characters that formed them. The caller advances its own pointer by
 * `consumed` and leaves the trailing partial sentence buffered until it
 * completes (or the stream ends and the caller flushes the remainder).
 */
export function extractSentences(buffer: string): {
  sentences: string[];
  consumed: number;
} {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    const isTerminator =
      c === "." || c === "!" || c === "?" || c === "\u2026" || c === "\n";
    if (!isTerminator) continue;
    const next = buffer[i + 1];
    const isBoundary = c === "\n" || next === undefined || /\s/.test(next);
    if (!isBoundary) continue;
    const piece = buffer.slice(start, i + 1).trim();
    // Skip stray punctuation-only fragments; keep anything with real words.
    if (piece.replace(/[.!?\u2026\s]/g, "").length > 0) {
      sentences.push(piece);
      start = i + 1;
    }
  }
  return { sentences, consumed: start };
}
