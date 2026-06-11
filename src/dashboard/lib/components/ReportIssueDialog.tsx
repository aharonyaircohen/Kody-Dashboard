/**
 * @fileType component
 * @domain kody
 * @pattern report-issue-dialog
 * @ai-summary Dialog for QA to flag unresolved issues. Adds kody:needs-fix label and posts a 🛑 QA: comment.
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
import { AlertTriangle, Loader2, Eye, Edit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@dashboard/lib/utils/ui";
import { autoDirProps, rtlAwareMarkdownClassName } from "../text-direction";

interface ReportIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => Promise<void>;
  issueNumber: number;
}

export function ReportIssueDialog({
  isOpen,
  onClose,
  onSubmit,
  issueNumber,
}: ReportIssueDialogProps) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(notes.trim());
      setNotes("");
      setShowPreview(false);
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Report Issue on #{issueNumber}
          </DialogTitle>
          <DialogDescription>
            Document unresolved problems found during QA. Adds the{" "}
            <code className="text-red-400">kody:needs-fix</code> label and pins
            your notes on the task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Editor / Preview toggle */}
          <div className="flex items-center gap-1 border-b border-zinc-800 pb-2">
            <button
              onClick={() => setShowPreview(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                !showPreview
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Edit className="w-3 h-3" /> Write
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                showPreview
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
          </div>

          {!showPreview ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's broken or unresolved?&#10;&#10;e.g., Header overlaps the nav on mobile widths. Loading spinner never disappears after submit."
              dir="auto"
              className="w-full h-40 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-500/50 placeholder:text-zinc-600 font-mono text-start"
              autoFocus
            />
          ) : (
            <div className="min-h-[160px] px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg overflow-y-auto">
              {notes.trim() ? (
                <div
                  {...autoDirProps}
                  className={cn(
                    "prose prose-invert prose-sm max-w-none text-start",
                    rtlAwareMarkdownClassName,
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {notes}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-zinc-600 text-sm italic">
                  Nothing to preview
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!notes.trim() || submitting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Reporting...
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 mr-2" />
                Report Issue
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
