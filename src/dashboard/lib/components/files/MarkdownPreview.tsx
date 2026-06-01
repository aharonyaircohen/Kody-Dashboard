/**
 * @fileType component
 * @domain files
 * @pattern markdown-preview
 * @ai-summary ReactMarkdown renderer with GFM support for markdown preview mode.
 */
"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Edit3 } from "lucide-react";
import { useFilesContext } from "./FilesContext";

interface MarkdownPreviewProps {
  onBack: () => void;
}

export function MarkdownPreview({ onBack }: MarkdownPreviewProps) {
  const { fileContent, selectedFile } = useFilesContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-white/40">Loading preview…</div>
      </div>
    );
  }

  if (!fileContent || !selectedFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-white/40">No file selected</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">
            {selectedFile.name}
          </span>
          <span className="text-[10px] text-white/40 px-1.5 py-0.5 rounded bg-white/[0.06]">
            Preview
          </span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>

      {/* Markdown content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <article
          className="prose prose-invert prose-sm max-w-none
          prose-headings:text-white/90
          prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
          prose-p:text-white/70
          prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline
          prose-code:text-amber-300 prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10
          prose-blockquote:border-l-emerald-500 prose-blockquote:text-white/50
          prose-strong:text-white/90
          prose-ul:text-white/70 prose-ol:text-white/70
          prose-li:marker:text-white/30
          prose-table:text-white/70
          prose-th:text-white/80 prose-td:text-white/70
          prose-hr:border-white/10
          prose-img:rounded
        "
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {fileContent.content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
