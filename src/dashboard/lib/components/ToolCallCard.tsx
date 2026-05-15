/**
 * @fileType component
 * @domain kody
 * @pattern tool-call-card
 * @ai-summary Expandable tool call card showing name, arguments, result, status, and duration
 */
"use client";

import { useState } from "react";
import { cn } from "@dashboard/lib/utils/ui";

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "running" | "success" | "error";
  startedAt?: number;
  durationMs?: number;
}

interface ToolCallCardProps {
  toolCall: ToolCall;
  expanded?: boolean;
  className?: string;
}

/**
 * Format a tool name for display (e.g., "get_file_contents" -> "Get File Contents")
 */
function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Format arguments or result as JSON
 */
function formatJSON(obj: unknown, maxLength = 500): string {
  const json = JSON.stringify(obj, null, 2);
  if (json.length <= maxLength) return json;
  return json.slice(0, maxLength) + "\n\n[... truncated ...]";
}

export function ToolCallCard({ toolCall, className }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusStyles: Record<
    string,
    { icon: string; borderColor: string; bgColor: string }
  > = {
    running: {
      icon: "⏳",
      borderColor: "border-blue-500",
      bgColor: "bg-blue-50 dark:bg-blue-900/20",
    },
    success: {
      icon: "✅",
      borderColor: "border-green-500",
      bgColor: "bg-green-50 dark:bg-green-900/20",
    },
    error: {
      icon: "❌",
      borderColor: "border-red-500",
      bgColor: "bg-red-50 dark:bg-red-900/20",
    },
  };

  const status = statusStyles[toolCall.status];
  const hasArguments = Object.keys(toolCall.arguments).length > 0;
  const hasResult = toolCall.result !== undefined;

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 overflow-hidden transition-all",
        status.borderColor,
        status.bgColor,
        className,
      )}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span className="text-sm">{status.icon}</span>
        <span className="font-medium text-sm flex-1">
          {formatToolName(toolCall.name)}
        </span>
        {toolCall.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">
            {toolCall.durationMs < 1000
              ? `${toolCall.durationMs}ms`
              : `${(toolCall.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {isExpanded ? "▼" : "▶"}
        </span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Arguments */}
          {hasArguments && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Input:
              </p>
              <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-32">
                <code>{formatJSON(toolCall.arguments)}</code>
              </pre>
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Output:
              </p>
              <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-48">
                <code>
                  {toolCall.status === "error"
                    ? formatJSON({ error: toolCall.result })
                    : formatJSON(toolCall.result)}
                </code>
              </pre>
            </div>
          )}

          {/* Running state */}
          {toolCall.status === "running" && (
            <p className="text-xs text-muted-foreground italic">Running...</p>
          )}

          {/* Error state */}
          {toolCall.status === "error" && !hasResult && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {String(toolCall.result || "Tool call failed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Render multiple tool calls in a compact list
 */
interface ToolCallListProps {
  toolCalls: ToolCall[];
  className?: string;
}

export function ToolCallList({ toolCalls, className }: ToolCallListProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className={cn("space-y-1", className)}>
      {toolCalls.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
    </div>
  );
}

/**
 * Collapsible "thinking" panel that consolidates all tool calls for a single
 * assistant turn behind one header. Keeps the chat thread clean while still
 * letting the user expand to audit what the agent ran.
 */
interface ThinkingPanelProps {
  toolCalls: ToolCall[];
  /** Whether the agent is still producing output (affects the summary label). */
  isStreaming?: boolean;
  className?: string;
}

export function ThinkingPanel({
  toolCalls,
  isStreaming,
  className,
}: ThinkingPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (toolCalls.length === 0) return null;

  const running = toolCalls.some((tc) => tc.status === "running");
  const errored = toolCalls.filter((tc) => tc.status === "error").length;
  const label = isStreaming || running ? "Thinking" : "Thought";
  const summary =
    `${label} — ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}` +
    (errored > 0 ? `, ${errored} failed` : "");

  return (
    <div
      className={cn(
        "my-1 rounded-md border border-border/60 bg-background/50",
        className,
      )}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-2 py-1 flex items-center gap-2 text-left text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"
        aria-expanded={isOpen}
      >
        <span>{running ? "⏳" : errored > 0 ? "⚠️" : "🧠"}</span>
        <span className="flex-1 italic">{summary}</span>
        <span>{isOpen ? "▼" : "▶"}</span>
      </button>
      {isOpen && (
        <div className="px-2 pb-2">
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible panel for model reasoning extracted from <think>...</think>
 * blocks in the assistant content. Defaults closed so the chat stays focused
 * on the final answer; user can expand to audit the chain of thought.
 */
interface ReasoningPanelProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function ReasoningPanel({
  content,
  isStreaming,
  className,
}: ReasoningPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const trimmed = content.trim();
  if (!trimmed) return null;

  const label = isStreaming ? "Thinking" : "Thought";

  return (
    <div
      className={cn(
        "my-1 rounded-md border border-border/60 bg-background/50",
        className,
      )}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-2 py-1 flex items-center gap-2 text-left text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"
        aria-expanded={isOpen}
      >
        <span>{isStreaming ? "⏳" : "💭"}</span>
        <span className="flex-1 italic">{label}</span>
        <span>{isOpen ? "▼" : "▶"}</span>
      </button>
      {isOpen && (
        <div className="px-2 pb-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {trimmed}
        </div>
      )}
    </div>
  );
}

/**
 * Split assistant content into reasoning blocks (inside <think>...</think>)
 * and the visible answer (everything outside). Tolerates an unclosed final
 * <think> block during streaming — that tail is treated as live reasoning.
 */
export function parseReasoning(raw: string): {
  reasoning: string;
  answer: string;
} {
  if (!raw) return { reasoning: "", answer: "" };
  const reasoningParts: string[] = [];
  let answer = "";
  let cursor = 0;
  const re = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    answer += raw.slice(cursor, match.index);
    reasoningParts.push(match[1]);
    cursor = re.lastIndex;
    if (!raw.slice(match.index).match(/<\/think>/i)) break;
  }
  answer += raw.slice(cursor);
  return { reasoning: reasoningParts.join("\n\n"), answer };
}
