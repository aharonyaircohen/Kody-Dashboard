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
  "create_kody_duty",
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
  return {
    reasoning,
    answer: stripToolCallMarkup(answer),
  };
}
