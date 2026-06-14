/**
 * @fileType utility
 * @domain kody
 * @pattern tool-call-markup-stripper
 * @ai-summary Strips tool-call XML markup (`<tool_name />` and
 *   `<tool_call>…</tool_call>` blocks) from assistant text so the model
 *   can't leak its tool invocation syntax into the user-visible bubble.
 *   The structured call is captured separately as a `ToolCall` and
 *   surfaced via `ThinkingPanel`; the inline markup is just noise.
 */

import { parseReasoning } from "./reasoning";

/**
 * Names of tools the kody agents expose. Tags whose name matches any
 * entry here (self-closing or open/close pair) are stripped from the
 * visible text. Sourced from `src/dashboard/lib/agents.ts` and the
 * issue-creation tool-name set in `kody-chat-types.ts`.
 */
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "kody_run_issue",
  "kody_fix_pr",
  "kody_fix_ci_pr",
  "kody_review_pr",
  "kody_resolve_pr",
  "kody_revert_pr",
  "kody_sync_pr",
  "request_release",
  "report_bug",
  "create_feature",
  "create_enhancement",
  "create_refactor",
  "create_documentation",
  "create_chore",
  "read_duty_creation_guide",
  "create_or_update_kody_duty",
  "create_kody_staff",
  "github_search_code",
  "github_get_file",
  "github_blame",
  "github_list_issues",
  "github_get_issue",
  "github_get_pull_request",
  "list_dashboard_features",
  "describe_feature",
  "switch_agent",
  "remote_write",
  "remote_read",
  "remote_bash",
  "github_close_issue",
  "github_create_issue",
  "remember",
  "recall",
  "update_memory",
  "preview_act",
  "read_executable_creation_guide",
]);

/**
 * `<tool_call>…</tool_call>` (closed or unclosed-tail). The unclosed form
 * handles streaming — when the model has emitted the opening tag but
 * not the close, we still strip the partial so the bubble doesn't blink
 * on raw XML.
 */
const TOOL_CALL_BLOCK_RE =
  /<\s*tool_call\b[^>]*>[\s\S]*?(?:<\s*\/\s*tool_call\s*>|$)/gi;

/**
 * Self-closing tag (`<name … />`) — capture the tag name so we can
 * filter by `KNOWN_TOOL_NAMES`.
 */
const SELF_CLOSING_TAG_RE = /<\s*([a-zA-Z_][\w-]*)\b[^>]*?\/\s*>/g;

const TAG_NAME_RE = /^<\s*([a-zA-Z_][\w-]*)/;

/**
 * Recognized tag-name prefixes for dangling-tail handling. Includes
 * `tool_call` (for the block form) in addition to the tool names so
 * `<tool_cal…` is recognized as a partial that should be hidden.
 */
const DANGLING_TAG_NAMES: readonly string[] = [
  ...KNOWN_TOOL_NAMES,
  "tool_call",
];

function stripToolCallBlocks(text: string): string {
  return text.replace(TOOL_CALL_BLOCK_RE, "");
}

function stripSelfClosingToolTags(text: string): string {
  return text.replace(SELF_CLOSING_TAG_RE, (full, name: string) => {
    return KNOWN_TOOL_NAMES.has(name) ? "" : full;
  });
}

/**
 * If the text ends with a `<` followed by an unfinished tag whose name
 * is or could grow into a known tool name, drop the partial. This keeps
 * the cursor from blinking on `<kody_run_issu` or `<tool_cal` while the
 * stream is still arriving.
 */
function stripDanglingToolTagTail(text: string): string {
  const lt = text.lastIndexOf("<");
  if (lt === -1) return text;
  const tail = text.slice(lt);
  if (tail.includes(">")) return text;
  const m = tail.match(TAG_NAME_RE);
  if (!m) return text;
  const partial = m[1];
  for (const name of DANGLING_TAG_NAMES) {
    if (name.startsWith(partial)) return text.slice(0, lt);
  }
  return text;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

const FINAL_ANSWER_MARKER_RE =
  /(?:^|\n)\s*(?:final\s+answer|final|answer)\s*:\s*/i;
const LEADING_ANSWER_MARKER_RE =
  /^\s*(?:final\s+answer|final|answer)\s*:\s*/i;
const SCRATCHPAD_LABEL_RE =
  /^\s*(?:analysis|reasoning|thinking|thoughts?|scratchpad)\s*[:.-]/i;
// First/second-person reasoning preambles the model commonly emits as raw
// prose (without `<think>` tags) before the actual answer. The matching
// happens at the START of the text and is gated by a blank-line separator
// + non-empty rest in `stripLeakedReasoning` — that double gate keeps
// legitimate first-person questions like "I need one detail before I
// can run this safely: which branch should I use?" untouched.
const THINKING_PREAMBLE_RE = new RegExp(
  [
    String.raw`^\s*let\s+me\s+(?:think|consider|analyze|figure\s+out|check|look|see|examine|start|walk\s+through)`,
    String.raw`^\s*I\s+(?:need|should|will|must|can|have\s+to|want\s+to)\s+(?:to\s+)?(?:think|consider|analyze|figure\s+out|check|look|see|examine|start|decide|review)`,
    String.raw`^\s*(?:first|next|now|alright|ok(?:ay)?|so),?\s+(?:let'?s|let\s+me|I\s+(?:need|should|will|must|can|have\s+to))`,
    String.raw`^\s*the\s+user\s+(?:is\s+)?(?:asking|wants?|needs?|requested|mentioned|provided|sent)`,
    String.raw`^\s*looking\s+at\s+(?:the\s+)?(?:request|question|issue|user|code|file|task|repo|error|stack\s*trace)`,
    String.raw`^\s*(?:step|plan)\s*\d+\s*[:.-]`,
  ].join("|"),
  "i",
);

function stripLeadingAnswerMarker(text: string): string {
  return text.replace(LEADING_ANSWER_MARKER_RE, "").trim();
}

function looksLikeLeakedReasoning(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SCRATCHPAD_LABEL_RE.test(trimmed)) return true;
  if (THINKING_PREAMBLE_RE.test(trimmed)) return true;

  return (
    /^(?:the user|user|they)\b/i.test(trimmed) &&
    /\bI\s+(?:need|should|will|must|can|have to)\b/i.test(trimmed)
  );
}

function stripDuplicatedReasoningPrefix(
  answer: string,
  reasoning: string,
): { text: string; stripped: boolean } {
  const trimmedReasoning = reasoning.trim();
  if (!trimmedReasoning) return { text: answer, stripped: false };

  const leadingWhitespace = answer.match(/^\s*/)?.[0] ?? "";
  const rest = answer.slice(leadingWhitespace.length);
  if (!rest.startsWith(trimmedReasoning)) {
    return { text: answer, stripped: false };
  }

  return {
    text: rest.slice(trimmedReasoning.length).trim(),
    stripped: true,
  };
}

function appendLeaked(
  collected: string,
  next: string,
): string {
  const trimmed = next.trim();
  if (!trimmed) return collected;
  return collected ? `${collected}\n\n${trimmed}` : trimmed;
}

function stripLeakedReasoning(
  answer: string,
  reasoning: string,
): { text: string; leaked: string } {
  const duplicate = stripDuplicatedReasoningPrefix(answer, reasoning);
  let working = duplicate.text;
  let leaked = "";
  if (duplicate.stripped) {
    // The duplicated prefix is by definition leaked reasoning — it
    // already lives in `reasoning`, so reuse the trimmed duplicate text
    // rather than rescanning. Then peel any "Final answer:" marker that
    // was inlined into the duplicate.
    working = stripLeadingAnswerMarker(working);
  }

  const trimmed = working.trim();

  // "Final answer:" / "Answer:" marker — strip everything before it when
  // the preamble is recognisably thinking.
  const marker = FINAL_ANSWER_MARKER_RE.exec(trimmed);
  if (marker && marker.index > 0) {
    const beforeMarker = trimmed.slice(0, marker.index);
    if (looksLikeLeakedReasoning(beforeMarker)) {
      return {
        text: trimmed.slice(marker.index + marker[0].length).trim(),
        leaked: appendLeaked(leaked, beforeMarker),
      };
    }
  }

  // Untagged thinking preamble: a leading paragraph (everything before the
  // first blank line) that matches a clear "I'm thinking" pattern, followed
  // by a real answer paragraph. Gated by a blank-line separator + non-empty
  // rest so legitimate first-person prose isn't touched. Catches the common
  // case where the model just outputs "Let me think about this...\n\n<answer>"
  // without any marker.
  const preambleMatch = trimmed.match(/^([\s\S]+?)\n\s*\n([\s\S]+)$/);
  if (preambleMatch) {
    const preamble = preambleMatch[1].trim();
    const rest = preambleMatch[2].trim();
    if (rest.length > 0 && looksLikeLeakedReasoning(preamble)) {
      return {
        text: rest,
        leaked: appendLeaked(leaked, preamble),
      };
    }
  }

  return { text: trimmed, leaked };
}

/**
 * Remove the model-emitted tool-call markup from `text` so the visible
 * answer bubble shows prose only. Safe on empty / plain input (returns
 * the input unchanged for `null`/empty/strings without tool markup).
 */
export function stripToolCallMarkup(text: string): string {
  if (!text) return text;
  let result = stripToolCallBlocks(text);
  result = stripSelfClosingToolTags(result);
  result = stripDanglingToolTagTail(result);
  result = collapseBlankLines(result);
  return result.trim();
}

/**
 * Parse assistant content into hidden reasoning and the visible answer,
 * additionally stripping tool-call markup from the answer. Used by the
 * chat bubble renderer; the underlying `parseReasoning` is left alone
 * so model-loop code (which intentionally preserves the tool-call
 * markup for context) is unaffected.
 */
export function parseAssistantContent(raw: string): {
  reasoning: string;
  answer: string;
} {
  if (!raw) return { reasoning: "", answer: "" };
  const { reasoning, answer } = parseReasoning(raw);
  const { text, leaked } = stripLeakedReasoning(
    stripToolCallMarkup(answer),
    reasoning,
  );
  const combinedReasoning = leaked
    ? reasoning
      ? `${reasoning}\n\n${leaked}`
      : leaked
    : reasoning;
  return { reasoning: combinedReasoning, answer: text };
}
