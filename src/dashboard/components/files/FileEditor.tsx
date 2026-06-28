/**
 * @fileType component
 * @domain files
 * @pattern file-editor
 * @ai-summary Editable Monaco Editor for the /files page. Supports
 *   read-only / edit mode, unsaved changes indicator, Ctrl+S save, and
 *   Markdown preview/split modes.
 */
"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";
import { Save, X, Loader2, Eye, Edit3, Columns } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { monacoLanguage } from "@dashboard/lib/repo-files-lang";
import { readFile, writeFile } from "@dashboard/lib/repo-files";
import type { Octokit } from "@octokit/rest";
import { MarkdownPreview } from "@dashboard/lib/components/MarkdownPreview";
import { CommitMessageDialog } from "./CommitMessageDialog";

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

type ViewMode = "edit" | "preview" | "split";

interface FileEditorProps {
  path: string;
  sha: string;
  octokit: Octokit | null;
  owner: string;
  repo: string;
  onCancel: () => void;
  onSaved: () => void;
}

export function FileEditor({
  path,
  sha,
  octokit,
  owner,
  repo,
  onCancel,
  onSaved,
}: FileEditorProps) {
  const [originalContent, setOriginalContent] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<unknown>(null);

  const isMarkdown = path.endsWith(".md") || path.endsWith(".mdx");

  // Load file content on mount
  useEffect(() => {
    if (!octokit || !path) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const file = await readFile(octokit, owner, repo, path);
        if (!file) {
          setError("File not found");
          return;
        }
        setOriginalContent(file.content);
        setContent(file.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [octokit, owner, repo, path]);

  // Track dirty state
  useEffect(() => {
    setIsDirty(content !== originalContent);
  }, [content, originalContent]);

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          setShowCommitDialog(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saving]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleEditorMount = useCallback((editor: unknown) => {
    editorRef.current = editor;
  }, []);

  const handleSave = useCallback(
    async (message: string) => {
      if (!octokit) return;
      setSaving(true);
      try {
        await writeFile(octokit, owner, repo, path, content, message, sha);
        setOriginalContent(content);
        setIsDirty(false);
        toast.success("File saved");
        setShowCommitDialog(false);
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save file");
      } finally {
        setSaving(false);
      }
    },
    [octokit, owner, repo, path, content, sha, onSaved],
  );

  const handleCancel = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        "Discard unsaved changes? This cannot be undone.",
      );
      if (!confirmed) return;
    }
    setContent(originalContent);
    setIsDirty(false);
    onCancel();
  }, [isDirty, originalContent, onCancel]);

  const fileName = path.split("/").pop() ?? path;

  return (
    <div className="flex flex-col h-full">
      {/* Metadata bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-body-sm font-medium truncate">{fileName}</span>
          <span className="text-body-xs text-white/40 truncate">{path}</span>
          {isDirty && (
            <span className="text-body-xs px-2 py-1 rounded bg-amber-500/20 text-amber-400">
              Unsaved
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {isMarkdown && (
            <div className="flex items-center gap-1 mr-2 border border-white/10 rounded">
              <button
                className={cn(
                  "p-2 rounded-l text-body-xs",
                  viewMode === "edit"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/70",
                )}
                onClick={() => setViewMode("edit")}
                title="Edit mode"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "p-2 text-body-xs",
                  viewMode === "preview"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/70",
                )}
                onClick={() => setViewMode("preview")}
                title="Preview mode"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "p-2 rounded-r text-body-xs",
                  viewMode === "split"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/70",
                )}
                onClick={() => setViewMode("split")}
                title="Split mode"
              >
                <Columns className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            onClick={handleCancel}
            className={cn(
              "flex items-center gap-1.5 text-body-xs px-3 py-2 rounded",
              "text-white/60 hover:text-white/90 hover:bg-white/10",
            )}
          >
            <X className="w-4 h-4" />
            Cancel
          </button>

          <button
            onClick={() => setShowCommitDialog(true)}
            disabled={!isDirty || saving}
            className={cn(
              "flex items-center gap-1.5 text-body-xs px-3 py-2 rounded",
              "bg-emerald-600/80 hover:bg-emerald-600 text-white",
              (!isDirty || saving) && "opacity-50 cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Editor / Preview area */}
      <div className="flex-1 min-h-0 flex">
        {loading ? (
          <div className="flex items-center justify-center w-full">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center w-full text-white/40">
            <span>{error}</span>
          </div>
        ) : viewMode === "edit" || viewMode === "split" ? (
          <div
            className={cn("flex-1 min-h-0", viewMode === "split" && "w-1/2")}
          >
            <MonacoEditor
              height="100%"
              language={monacoLanguage(path)}
              value={content}
              theme="vs-dark"
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                readOnly: false,
                minimap: { enabled: true },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                fontSize: 15,
                wordWrap: "on",
                automaticLayout: true,
              }}
            />
          </div>
        ) : null}

        {viewMode === "preview" && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <MarkdownPreview content={content} />
          </div>
        )}

        {viewMode === "split" && <div className="w-px bg-white/10" />}

        {viewMode === "split" && (
          <div className="w-1/2 min-h-0 overflow-y-auto p-4">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <CommitMessageDialog
          onConfirm={handleSave}
          onCancel={() => setShowCommitDialog(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
