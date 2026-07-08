/**
 * @fileType utility
 * @domain chat
 * @pattern display-formatting
 * @ai-summary Soft display-only formatter for user-authored chat text.
 */

const FENCE_LINE_RE = /^\s*```/;
const BULLET_LIKE_RE = /^(\s*)([•◦▪]|[-*+]|\d+[\).])\s+(.*)$/;
const SENTENCE_BOUNDARY_RE = /([.!?])\s+(?=\S)/g;
const MARKDOWN_BLOCK_RE = /^\s*(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|\|.*\|)/;

export function softFormatUserMessageForDisplay(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return content;

  return splitFenceAware(normalized)
    .map((part) =>
      part.kind === "code" ? part.text : formatTextPart(part.text),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function splitFenceAware(
  content: string,
): Array<{ kind: "text" | "code"; text: string }> {
  const parts: Array<{ kind: "text" | "code"; text: string }> = [];
  let current: string[] = [];
  let kind: "text" | "code" = "text";

  for (const line of content.split("\n")) {
    const isFence = FENCE_LINE_RE.test(line);
    if (isFence && current.length > 0) {
      parts.push({ kind, text: current.join("\n") });
      current = [];
    }
    if (isFence) kind = kind === "code" ? "text" : "code";
    current.push(line);
  }

  if (current.length > 0) parts.push({ kind, text: current.join("\n") });
  return parts;
}

function formatTextPart(text: string): string {
  const cleaned = text
    .split("\n")
    .map((line) => normalizeLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned
    .split(/\n{2,}/)
    .map((paragraph) => softenParagraph(paragraph))
    .join("\n\n");
}

function normalizeLine(line: string): string {
  if (!line.trim()) return "";
  if (/^( {4}|\t)/.test(line)) return line.replace(/[ \t]+$/g, "");

  const bullet = line.match(BULLET_LIKE_RE);
  if (!bullet) return line.trim();

  const marker = bullet[2];
  const body = bullet[3].trim();
  if (/^\d+\)$/.test(marker)) {
    return `${marker.slice(0, -1)}. ${body}`;
  }
  if (["•", "◦", "▪"].includes(marker)) return `- ${body}`;
  return `${marker} ${body}`;
}

function softenParagraph(paragraph: string): string {
  if (!paragraph || paragraph.includes("\n")) return paragraph;
  if (paragraph.length < 90) return paragraph;
  if (MARKDOWN_BLOCK_RE.test(paragraph)) return paragraph;

  const softened = paragraph.replace(SENTENCE_BOUNDARY_RE, "$1\n\n");
  const paragraphCount = softened.split(/\n{2,}/).filter(Boolean).length;
  return paragraphCount > 1 ? softened : paragraph;
}
