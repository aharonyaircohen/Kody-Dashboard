/**
 * @fileType component
 * @domain files
 * @pattern file-viewer
 * @ai-summary Read-only Monaco Editor viewer for the /files page.
 *   Displays file content with syntax highlighting, line numbers, and
 *   a metadata bar showing path, size, and last commit info.
 */
"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";
import { Copy, Loader2, FileQuestion } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { monacoLanguage } from "@dashboard/lib/repo-files-lang";
import { readFile } from "@dashboard/lib/repo-files";
import type { Octokit } from "@octokit/rest";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    ),
  },
) as React.ComponentType<EditorProps>;

interface FileViewerProps {
  path: string;
  sha: string;
  octokit: Octokit | null;
  owner: string;
  repo: string;
  onEdit?: () => void;
  onViewDiff?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function FileViewer({
  path,
  sha,
  octokit,
  owner,
  repo,
  onEdit,
  onViewDiff,
}: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file content
  const loadContent = useCallback(async () => {
    if (!octokit || !path) return;
    setLoading(true);
    setError(null);
    try {
      const file = await readFile(octokit, owner, repo, path);
      if (!file) {
        setError("File not found");
        return;
      }
      setContent(file.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [octokit, owner, repo, path]);

  // Load on mount or path change
  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content).then(() => {
        toast.success("Copied to clipboard");
      });
    }
  };

  const fileName = path.split("/").pop() ?? path;
  const lang = monacoLanguage(path);

  return (
    <div className="flex flex-col h-full">
      {/* Metadata bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{fileName}</span>
          <span className="text-xs text-white/40 truncate">{path}</span>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-white/40 shrink-0">
          {sha && <span className="font-mono">{sha.slice(0, 7)}</span>}
          <span className="flex items-center gap-1">
            <FileQuestion className="w-3 h-3" />
            {formatBytes(content?.length ?? 0)}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 shrink-0">
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1.5 text-xs px-2 py-1 rounded",
            "text-white/60 hover:text-white/90 hover:bg-white/10",
          )}
          title="Copy file content"
        >
          <Copy className="w-3.5 h-3.5" />
          Copy
        </button>

        {onEdit && (
          <button
            onClick={onEdit}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded",
              "text-white/60 hover:text-white/90 hover:bg-white/10",
            )}
          >
            Edit
          </button>
        )}

        {onViewDiff && (
          <button
            onClick={onViewDiff}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded",
              "text-white/60 hover:text-white/90 hover:bg-white/10",
            )}
          >
            History / Diff
          </button>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40">
            <FileQuestion className="w-8 h-8 mb-2" />
            <span>{error}</span>
          </div>
        ) : content ? (
          <MonacoEditor
            height="100%"
            language={lang}
            value={content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: true },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
