/**
 * @fileType component
 * @domain files
 * @pattern file-viewer
 * @ai-summary Monaco Editor in read-only mode for viewing files.
 */
"use client";

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Copy, Check, History, Edit3 } from "lucide-react";
import { useFilesContext } from "./FilesContext";
import { detectLanguage } from "@dashboard/lib/repo-files-lang";
import { cn } from "@dashboard/lib/utils";

// Dynamic import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-white/40 text-sm">
      Loading editor…
    </div>
  ),
});

interface FileViewerProps {
  onOpenHistory: () => void;
  onStartEdit: () => void;
}

export function FileViewer({ onOpenHistory, onStartEdit }: FileViewerProps) {
  const { fileContent, isLoadingContent, selectedFile } = useFilesContext();

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!fileContent?.content) return;
    try {
      await navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed
    }
  }, [fileContent?.content]);

  if (isLoadingContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-white/40 animate-pulse">
          Loading {selectedFile?.name ?? "file"}…
        </div>
      </div>
    );
  }

  if (!fileContent || !selectedFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-white/40">Select a file to view</div>
      </div>
    );
  }

  const language = detectLanguage(selectedFile.name);

  return (
    <div className="flex flex-col h-full">
      {/* Metadata bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">
            {selectedFile.name}
          </span>
          {fileContent.lastCommit && (
            <span className="text-[10px] text-white/40 shrink-0">
              {fileContent.lastCommit.author} ·{" "}
              {new Date(fileContent.lastCommit.date).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onStartEdit}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            title="Edit file"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            title="View history"
          >
            <History className="w-3.5 h-3.5" />
            History
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            title="Copy file content"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={language}
          value={fileContent.content}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: true },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            renderWhitespace: "selection",
            wordWrap: "on",
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      </div>
    </div>
  );
}
