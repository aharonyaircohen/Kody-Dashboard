/**
 * @fileType component
 * @domain kody
 * @pattern attachment-bar
 * @ai-summary Paperclip button + uploaded-file chips + hidden file input,
 *   driven by useCommentAttachments. Dropped into every GitHub-backed comment
 *   composer (issues, PRs, goal discussions) for a consistent attach UX.
 */
"use client";

import { Loader2, Paperclip, X } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { cn } from "@dashboard/lib/utils/ui";
import type { useCommentAttachments } from "../hooks/useCommentAttachments";

type AttachmentsApi = ReturnType<typeof useCommentAttachments>;

export function AttachmentBar({
  api,
  disabled,
  className,
}: {
  api: AttachmentsApi;
  disabled?: boolean;
  className?: string;
}) {
  const { attachments, removeAttachment, openPicker, inputRef, onInputChange } =
    api;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={openPicker}
        disabled={disabled}
        className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
        title="Attach a file"
      >
        <Paperclip className="w-3 h-3" />
      </Button>

      {attachments.map((a) => (
        <span
          key={a.id}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] max-w-[180px]",
            a.status === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/50 text-foreground",
          )}
          title={a.error || a.name}
        >
          {a.status === "uploading" ? (
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          ) : null}
          <span className="truncate">{a.name}</span>
          <button
            type="button"
            onClick={() => removeAttachment(a.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
            title="Remove"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
