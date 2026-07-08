"use client";

/**
 * @fileType component
 * @domain chat-surface
 * @pattern kody-chat-extraction (phase 1.6d)
 *
 * Empty-state body for the chat message list — extracted verbatim from
 * KodyChat.tsx (phase 1.6d). Purely presentational: props in, the exact
 * same DOM out. The host decides which scope branch applies by passing
 * the mode flags + scope objects it already derives.
 */
import type { KodyTask } from "../../types";
import { VIBE_TASK_EMPTY_STATE_HINT } from "../plugins/vibe";

interface EmptyStateProps {
  isTaskMode: boolean;
  vibeMode?: boolean;
  selectedTask: KodyTask | null;
  isCapabilityMode: boolean;
  selectedCapability: { slug: string } | null;
  isPlannerMode: boolean;
  plannerGoal: { name: string } | null;
}

export function EmptyState({
  isTaskMode,
  vibeMode,
  selectedTask,
  isCapabilityMode,
  selectedCapability,
  isPlannerMode,
  plannerGoal,
}: EmptyStateProps) {
  return (
    <div className="text-center text-muted-foreground text-base py-8">
      {isTaskMode ? (
        <>
          <p className="font-medium">Chat about this task</p>
          <p className="text-sm mt-1">
            {vibeMode
              ? VIBE_TASK_EMPTY_STATE_HINT
              : "Messages will be saved to the task"}
          </p>
          <p className="text-sm mt-3 font-medium text-foreground">
            I can help you:
          </p>
          <ul className="mt-2 text-left text-sm space-y-2 max-w-sm mx-auto">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>
                Diagnose the linked PR if it didn&apos;t fully fix the issue —
                try{" "}
                <span className="font-mono">
                  &quot;diagnose{" "}
                  {selectedTask?.associatedPR
                    ? `PR #${selectedTask.associatedPR.number}`
                    : "this PR"}
                  &quot;
                </span>
                . I&apos;ll read the diff, find the gap, and draft a sharper{" "}
                <span className="font-mono">@kody fix</span> for your approval.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Explain the issue, the PR diff, or pipeline status</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Browse and search the repository for related code</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>
                Draft a follow-up <span className="font-mono">@kody</span>{" "}
                instruction
              </span>
            </li>
          </ul>
        </>
      ) : isCapabilityMode && selectedCapability ? (
        <>
          <p className="font-medium text-foreground">
            Chat about `{selectedCapability.slug}`
          </p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Ask anything about this capability&apos;s intent, scope, or rules.
            Each capability has its own thread.
          </p>
        </>
      ) : isPlannerMode && plannerGoal ? (
        <>
          <p className="font-medium text-foreground">
            Plan tasks for &ldquo;{plannerGoal.name}&rdquo;
          </p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Say <span className="font-mono">&quot;plan it&quot;</span> (or paste
            extra context first). I&apos;ll propose a task list, you approve,
            then I&apos;ll deepen each spec and create the issues attached to
            this goal.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">Hi! I can help you with:</p>
          <ul className="mt-3 text-left text-sm space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Browse repository files and code</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Search code across the codebase</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>List and explain tasks</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Show pipeline status and progress</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>
                Diagnose a Kody PR that didn&apos;t fully solve its issue — try{" "}
                <span className="font-mono">&quot;diagnose PR #1404&quot;</span>
              </span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
