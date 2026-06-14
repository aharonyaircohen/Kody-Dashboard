/**
 * @fileType component
 * @domain kody
 * @pattern issue-attachment-button
 * @ai-summary Standalone file picker that uploads attachments and posts them
 *   to a GitHub issue with an @kody trigger comment.
 */
"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@dashboard/ui/button";
import { uploadCommentAttachmentFile } from "../hooks/useCommentAttachments";
import { usePostComment } from "../hooks";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";

interface IssueAttachmentButtonProps {
  issueNumber: number;
  onAttachmentAdded?: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}

export function buildIssueAttachmentComment(paths: string[]): string {
  const list = paths.map((path) => `- \`${path}\``).join("\n");
  const prompt =
    paths.length === 1
      ? "Attachment added. Please read this file before acting:"
      : "Attachments added. Please read these files before acting:";

  return `@kody\n\n${prompt}\n${list}`;
}

export function IssueAttachmentButton({
  issueNumber,
  onAttachmentAdded,
  disabled = false,
  className,
  label = "Add attachment",
  variant = "outline",
  size = "sm",
}: IssueAttachmentButtonProps) {
  const [isAddingAttachment, setIsAddingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { githubUser } = useGitHubIdentity();
  const { mutateAsync: postComment, isPending: isPosting } = usePostComment(
    issueNumber,
    githubUser?.login,
  );

  const handleAttachmentChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || isAddingAttachment || isPosting) return;

    setIsAddingAttachment(true);
    try {
      const uploaded = await Promise.all(
        files.map(uploadCommentAttachmentFile),
      );
      const paths = uploaded.map((a) => a.path);
      await postComment(buildIssueAttachmentComment(paths));
      toast.success(
        files.length === 1 ? "Attachment added" : "Attachments added",
      );
      onAttachmentAdded?.();
    } catch (err) {
      toast.error("Failed to add attachment", {
        description: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setIsAddingAttachment(false);
    }
  };

  return (
    <>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentChange}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => attachmentInputRef.current?.click()}
        disabled={disabled || isAddingAttachment || isPosting}
        className={className}
        title={label}
      >
        {isAddingAttachment ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Paperclip className="w-4 h-4 mr-2" />
        )}
        {label}
      </Button>
    </>
  );
}
