/**
 * @fileType component
 * @domain files
 * @pattern commit-message-dialog
 * @ai-summary Modal dialog for entering a commit message when saving a file.
 */
"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Button } from "@dashboard/ui/button";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils";

interface CommitMessageDialogProps {
  onConfirm: (message: string) => void;
  onCancel: () => void;
  saving: boolean;
  defaultMessage?: string;
}

export function CommitMessageDialog({
  onConfirm,
  onCancel,
  saving,
  defaultMessage = "",
}: CommitMessageDialogProps) {
  const [message, setMessage] = useState(defaultMessage);

  // Focus textarea on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      document.getElementById("commit-message")?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onConfirm(message.trim());
    }
  };

  const isValid = message.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save changes</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="commit-message" className="text-sm text-white/70">
              Commit message
            </label>
            <Textarea
              id="commit-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your changes..."
              rows={3}
              className="mt-1.5 resize-none"
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || saving}
              className={cn(
                "bg-emerald-600 hover:bg-emerald-700",
                saving && "opacity-70",
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
