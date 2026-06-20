/**
 * @fileType component
 * @domain kody
 * @pattern markdown-viewer
 * @ai-summary Renders markdown content with syntax highlighting
 */
"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@dashboard/lib/utils/ui";
import { autoDirProps, rtlAwareMarkdownClassName } from "../text-direction";
import { MarkdownPreview } from "./MarkdownPreview";

interface MarkdownViewerProps {
  content: string;
  title?: string;
}

export function MarkdownViewer({ content, title }: MarkdownViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-sm font-medium">{title || "Document"}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-muted rounded"
          title="Copy markdown"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto max-h-[600px]">
        <MarkdownPreview
          {...autoDirProps}
          content={content}
          variant="compact"
          className={cn("text-start", rtlAwareMarkdownClassName)}
        />
      </div>
    </div>
  );
}
