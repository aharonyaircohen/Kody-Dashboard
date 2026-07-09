export const FINAL_ANSWER_TOOL = "final_answer";
export const SHOW_VIEW_TOOL = "show_view";
export const FINAL_ANSWER_REQUIRES_VIEW_ERROR =
  "final_answer requires show_view for this interactive response";
export const CHAT_OUTPUT_TOOL_NAMES = [
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
] as const;

export interface FinalAnswerOutput {
  content: string;
}

export interface ToolErrorOutput {
  error: string;
}

export function getFinalAnswerContent(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const content = (input as { content?: unknown }).content;
  return typeof content === "string" && content.trim().length > 0
    ? content
    : null;
}

export function isFinalAnswerOutput(
  output: unknown,
): output is FinalAnswerOutput {
  return getFinalAnswerContent(output) !== null;
}

export function getToolErrorMessage(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim().length > 0 ? error : null;
}

export function isToolErrorOutput(output: unknown): output is ToolErrorOutput {
  return getToolErrorMessage(output) !== null;
}

export function isFinalAnswerRequiresViewOutput(output: unknown): boolean {
  return getToolErrorMessage(output) === FINAL_ANSWER_REQUIRES_VIEW_ERROR;
}

export function selectChatOutputActiveTools<T extends string>({
  toolNames,
  requireViewOutput,
  allowPreRenderTools,
  finalAnswerNeedsView,
}: {
  toolNames: readonly T[];
  requireViewOutput: boolean;
  allowPreRenderTools: boolean;
  finalAnswerNeedsView: boolean;
}): T[] {
  const showViewOnly = toolNames.filter((name) => name === SHOW_VIEW_TOOL);
  if (finalAnswerNeedsView) return showViewOnly;
  if (requireViewOutput) {
    return allowPreRenderTools
      ? toolNames.filter((name) => name !== FINAL_ANSWER_TOOL)
      : showViewOnly;
  }
  return [...toolNames];
}
