/**
 * @fileType component
 * @domain kody
 * @pattern markdown-preview
 * @ai-summary Component for rendering markdown files with preview
 */
"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@dashboard/lib/utils/ui";
import type { FileItem } from "./FilesContext";

interface MarkdownPreviewProps {
  content: string;
  file?: FileItem | null;
  className?: string;
}

export function MarkdownPreview({
  content,
  file,
  className,
}: MarkdownPreviewProps) {
  const isMarkdown = useMemo(() => {
    if (!file) return false;
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext === "md" || ext === "mdx" || ext === "markdown";
  }, [file]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      {file && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <span className="text-sm font-medium">{file.name}</span>
          {isMarkdown && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Markdown
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isMarkdown ? (
          <article className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        ) : (
          <pre className="font-mono text-sm whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </div>
  );
}
