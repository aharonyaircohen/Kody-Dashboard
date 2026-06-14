/**
 * @fileType component
 * @domain files
 * @pattern markdown-preview
 * @ai-summary Renders Markdown content as HTML with GitHub Flavored Markdown
 *   support (tables, task lists, strikethrough).
 */
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@dashboard/lib/utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        "prose-headings:text-white/90",
        "prose-p:text-white/70",
        "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
        "prose-code:text-emerald-400 prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded",
        "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-white/10",
        "proseblockquote:border-l-emerald-500 prose-blockquote:text-white/60",
        "prose-strong:text-white/90",
        "prose-ul:text-white/70 prose-ol:text-white/70",
        "prose-li:marker:text-white/40",
        "prose-table:text-white/70",
        "prose-th:text-white/80 prose-th:border-white/20",
        "prose-td:border-white/10",
        "prose-hr:border-white/10",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
