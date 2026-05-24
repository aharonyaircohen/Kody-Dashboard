/**
 * @fileType ui
 * @domain kody
 * @pattern message-attachments
 * @ai-summary Renders attachment chips (image preview for images, file icon
 *   otherwise) inside a user message bubble. Pulls the blob bytes from
 *   IndexedDB on mount so reload-from-history still shows the picture.
 */

"use client";

import { useState, useEffect } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { AttachmentRef } from "../chat-types";
import { getAttachmentDataUrl } from "../attachment-store";
import { formatFileSize, getFileIcon } from "./kody-chat-helpers";

export function MessageAttachments({
  attachments,
}: {
  attachments: AttachmentRef[];
}) {
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string | null> = {};
      for (const a of attachments) {
        if (!a.mimeType.startsWith("image/")) {
          next[a.id] = null;
          continue;
        }
        try {
          next[a.id] = await getAttachmentDataUrl(a.id);
        } catch {
          next[a.id] = null;
        }
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a) => {
        const dataUrl = previews[a.id];
        if (a.mimeType.startsWith("image/")) {
          return (
            <div
              key={a.id}
              className="relative max-w-[180px] rounded-md overflow-hidden border border-primary-foreground/20 bg-background/40"
              title={`${a.name} (${formatFileSize(a.size)})`}
            >
              {dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dataUrl}
                  alt={a.name}
                  className="block max-h-[180px] w-auto object-contain"
                />
              ) : (
                <div className="px-3 py-6 text-xs text-muted-foreground flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4" />
                  {dataUrl === null ? a.name : "Loading…"}
                </div>
              )}
            </div>
          );
        }
        return (
          <div
            key={a.id}
            className="flex items-center gap-1.5 px-2 py-1 bg-background/30 rounded-md text-xs"
            title={`${a.mimeType} • ${formatFileSize(a.size)}`}
          >
            {getFileIcon(a.mimeType)}
            <span className="max-w-[140px] truncate">{a.name}</span>
            <span className="opacity-70">{formatFileSize(a.size)}</span>
          </div>
        );
      })}
    </div>
  );
}
