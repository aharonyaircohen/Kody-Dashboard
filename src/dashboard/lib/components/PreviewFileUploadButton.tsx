/**
 * @fileType component
 * @domain preview
 * @pattern native-file-picker-trigger
 * @ai-summary Reusable preview upload trigger. Uses the browser-native file
 *   picker API when available, with a normal hidden file input fallback.
 */
"use client";

import { useRef, type ChangeEvent, type ReactNode } from "react";

import { cn } from "../utils";

type FileSystemFileHandleLike = {
  getFile: () => Promise<File>;
};

type ShowOpenFilePicker = (options?: {
  multiple?: boolean;
}) => Promise<FileSystemFileHandleLike[]>;

interface PreviewFileUploadButtonProps {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: string;
}

function getShowOpenFilePicker(): ShowOpenFilePicker | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window as Window & { showOpenFilePicker?: ShowOpenFilePicker }
  ).showOpenFilePicker;
  return typeof candidate === "function" ? candidate.bind(window) : null;
}

function isPickerCancel(error: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  );
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFallbackInput = (): void => {
    inputRef.current?.click();
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) onFiles(files);
    event.currentTarget.value = "";
  };

  const handleClick = (): void => {
    if (disabled) return;
    const openPicker = getShowOpenFilePicker();
    if (!openPicker) {
      openFallbackInput();
      return;
    }

    void (async () => {
      try {
        const handles = await openPicker({ multiple });
        const files = await Promise.all(
          handles.map((handle) => handle.getFile()),
        );
        if (files.length > 0) onFiles(files);
      } catch (error) {
        if (isPickerCancel(error)) return;
        openFallbackInput();
      }
    })();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        aria-label={ariaLabel}
        className="hidden"
        disabled={disabled}
        onChange={handleInputChange}
      />
      <button
        type="button"
        title={title}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "inline-flex cursor-pointer gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        {children}
      </button>
    </>
  );
}
