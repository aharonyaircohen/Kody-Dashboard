/**
 * @fileType utility
 * @domain kody
 * @pattern chat-reasoning-parser
 * @ai-summary Splits hidden scratchpad text from visible assistant replies.
 */

type ReasoningParseResult = {
  reasoning: string;
  answer: string;
};

type ScratchpadTag = {
  closing: boolean;
  end: number;
};

const SCRATCHPAD_TAG_RE = /^<\s*(\/?)\s*(think|thinking)\b[^>]*>/i;
const ENCODED_SCRATCHPAD_TAG_RE =
  /&lt;(\s*\/?\s*(?:think|thinking)\b[^&]{0,200})&gt;/gi;

function normalizeEncodedScratchpadTags(raw: string): string {
  return raw.replace(ENCODED_SCRATCHPAD_TAG_RE, "<$1>");
}

function readScratchpadTag(input: string, index: number): ScratchpadTag | null {
  if (input[index] !== "<") return null;
  const match = SCRATCHPAD_TAG_RE.exec(input.slice(index));
  if (!match) return null;
  return {
    closing: match[1].includes("/"),
    end: index + match[0].length,
  };
}

function isScratchpadTagPrefix(fragment: string): boolean {
  const compact = fragment
    .replace(/^<\s*\/\s*/i, "</")
    .replace(/^<\s*/i, "<")
    .toLowerCase();
  return (
    "<think".startsWith(compact) ||
    "<thinking".startsWith(compact) ||
    "</think".startsWith(compact) ||
    "</thinking".startsWith(compact) ||
    /^<\/?\s*thinking?\b/i.test(fragment)
  );
}

function stripDanglingScratchpadTagPrefix(text: string): string {
  const lt = text.lastIndexOf("<");
  if (lt === -1) return text;
  const tail = text.slice(lt);
  if (tail.includes(">")) return text;
  return isScratchpadTagPrefix(tail) ? text.slice(0, lt) : text;
}

function pushReasoning(parts: string[], value: string): void {
  const cleaned = stripDanglingScratchpadTagPrefix(value).trim();
  if (cleaned) parts.push(cleaned);
}

/**
 * Split assistant content into hidden reasoning and the visible answer.
 *
 * The dashboard stores streamed reasoning inline as scratchpad markers, so
 * this parser is deliberately tolerant: it handles <think> and <thinking>,
 * attributes/spaces, encoded tags, nested/pre-tagged chunks, and an unfinished
 * final tag while a stream is still arriving.
 */
export function parseReasoning(raw: string): ReasoningParseResult {
  if (!raw) return { reasoning: "", answer: "" };

  const input = normalizeEncodedScratchpadTags(raw);
  const reasoningParts: string[] = [];
  let answer = "";
  let currentReasoning = "";
  let depth = 0;
  let i = 0;

  while (i < input.length) {
    const tag = readScratchpadTag(input, i);
    if (tag) {
      if (tag.closing) {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0) {
            pushReasoning(reasoningParts, currentReasoning);
            currentReasoning = "";
          }
        }
      } else {
        depth += 1;
      }
      i = tag.end;
      continue;
    }

    if (depth > 0) {
      currentReasoning += input[i];
    } else {
      answer += input[i];
    }
    i += 1;
  }

  if (depth > 0) pushReasoning(reasoningParts, currentReasoning);

  return {
    reasoning: reasoningParts.join("\n\n"),
    answer: stripDanglingScratchpadTagPrefix(answer),
  };
}

export function stripReasoning(raw: string): string {
  return parseReasoning(raw).answer.trim();
}
