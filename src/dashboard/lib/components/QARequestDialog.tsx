/**
 * @fileType component
 * @domain kody
 * @pattern qa-request-dialog
 * @ai-summary Dialog to request a QA pass on an issue. Optional scope narrows
 *              focus; empty submit runs a broad smoke pass.
 */
"use client";

import { useState } from "react";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@dashboard/ui/dialog";
import { Stethoscope, Loader2 } from "lucide-react";

interface QARequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Receives trimmed scope text, or empty string for a broad smoke pass. */
  onSubmit: (scope: string) => Promise<void>;
  issueNumber: number;
}

export function QARequestDialog({
  isOpen,
  onClose,
  onSubmit,
  issueNumber,
}: QARequestDialogProps) {
  const [scope, setScope] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(scope.trim());
      setScope("");
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false);
    }
  };

  const hasScope = scope.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-emerald-400" />
            QA Issue #{issueNumber}
          </DialogTitle>
          <DialogDescription>
            Optional: narrow what Kody should verify. Leave empty for a broad
            smoke pass. Posts{" "}
            <code className="text-emerald-400">@kody qa-engineer</code> on the
            issue; the report comes back as a comment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="What should QA focus on? (optional)&#10;&#10;e.g., the empty state on the tasks list, mobile layout of the settings page, keyboard nav through the chat rail"
            className="w-full h-32 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-zinc-600 font-mono"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Stethoscope className="w-4 h-4 mr-2" />
                {hasScope ? "Run Focused QA" : "Run Broad QA"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
