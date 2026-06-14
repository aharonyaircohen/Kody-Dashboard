/**
 * @fileType component
 * @domain kody
 * @pattern goal-discussion-dialog
 * @ai-summary Modal that hosts a goal's discussion thread. Wraps the
 *   {@link GoalDiscussion} component so the rest of the dashboard can open
 *   the thread without a full page navigation. Driven by parent state — the
 *   dialog opens when `goal` is non-null.
 */
"use client";

import { Flag, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import type { Goal } from "../api";
import { GoalDiscussion } from "./GoalDiscussion";

export function GoalDiscussionDialog({
  goal,
  onClose,
}: {
  goal: Goal | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!goal}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sky-400" />
            Discussion — {goal?.name ?? "Goal"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-xs">
            <Flag className="w-3 h-3" />
            <span className="font-mono opacity-80">{goal?.id ?? ""}</span>
            <span>· comments live on github.com</span>
          </DialogDescription>
        </DialogHeader>
        {goal ? (
          <div className="mt-2">
            <GoalDiscussion goalId={goal.id} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
