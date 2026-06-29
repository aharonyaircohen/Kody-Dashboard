/**
 * @fileType component
 * @domain preview
 * @pattern native-file-input-label
 * @ai-summary Reusable preview upload control. Keeps the existing visual
 *   button/menu UI while a real file input owns the chooser activation.
 */
"use client";

import type { ChangeEvent, ReactNode } from "react";

import { cn } from "../utils";

interface PreviewFileUploadButtonProps {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: string;
}

export function PreviewFileUploadButton({
  "aria-label": ariaLabel = "Upload view files",
  children,
  className,
  disabled = false,
  multiple = true,
  onFiles,
  title,
}: PreviewFileUploadButtonProps) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) onFiles(files);
    event.currentTarget.value = "";
  };

  return (
    <label
      title={title}
      className={cn(
        "inline-flex min-w-0 cursor-pointer items-center gap-2 focus-within:outline-none focus-within:ring-1 focus-within:ring-sky-400",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="file"
        multiple={multiple}
        aria-label={ariaLabel}
        className="sr-only"
        disabled={disabled}
        onChange={handleInputChange}
      />
      {children}
    </label>
  );
}
