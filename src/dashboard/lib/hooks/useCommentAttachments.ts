/**
 * @fileType hook
 * @domain kody
 * @pattern comment-attachments
 * @ai-summary Drag/drop + file-picker upload state for the GitHub-backed
 *   comment composers. Uploads each file to /api/kody/attachments (which
 *   commits it to the repo) and yields markdown to append to the comment body.
 */
"use client";

import { useCallback, useRef, useState } from "react";

import { getStoredAuth } from "../api";

const MAX_BYTES = 10 * 1024 * 1024; // keep in sync with the route's cap

export interface CommentAttachment {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  /** Markdown snippet to embed in the comment body once uploaded. */
  markdown?: string;
  error?: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the `data:<mime>;base64,` prefix — keep only the payload.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useCommentAttachments() {
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((id: string, next: Partial<CommentAttachment>) => {
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...next } : a)),
    );
  }, []);

  const uploadOne = useCallback(
    async (file: File) => {
      const id =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      if (file.size > MAX_BYTES) {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            status: "error",
            error: "File too large (10 MB max)",
          },
        ]);
        return;
      }

      setAttachments((prev) => [
        ...prev,
        { id, name: file.name, status: "uploading" },
      ]);

      try {
        const contentBase64 = await readAsBase64(file);
        const auth = getStoredAuth();
        const res = await fetch("/api/kody/attachments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth
              ? {
                  "x-kody-token": auth.token,
                  "x-kody-owner": auth.owner,
                  "x-kody-repo": auth.repo,
                }
              : {}),
          },
          body: JSON.stringify({ name: file.name, contentBase64 }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.error || `Upload failed (${res.status})`);
        }
        const { markdown, name } = (await res.json()) as {
          markdown: string;
          name: string;
        };
        patch(id, { status: "done", markdown, name });
      } catch (err) {
        patch(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      Array.from(files).forEach((f) => void uploadOne(f));
    },
    [uploadOne],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const reset = useCallback(() => setAttachments([]), []);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files);
      e.target.value = ""; // allow re-selecting the same file
    },
    [addFiles],
  );

  const dropzoneProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setIsDragging(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files?.length) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
  };

  /** True while any file is still uploading — block submit until clear. */
  const isUploading = attachments.some((a) => a.status === "uploading");

  /** Append uploaded attachment markdown to a comment body. */
  const withAttachments = useCallback(
    (body: string) => {
      const refs = attachments
        .filter((a) => a.status === "done" && a.markdown)
        .map((a) => a.markdown as string);
      if (refs.length === 0) return body;
      const sep = body.trim() ? `${body.trim()}\n\n` : "";
      return `${sep}${refs.join("\n")}`;
    },
    [attachments],
  );

  return {
    attachments,
    isDragging,
    isUploading,
    inputRef,
    addFiles,
    removeAttachment,
    reset,
    openPicker,
    onInputChange,
    dropzoneProps,
    withAttachments,
  };
}
