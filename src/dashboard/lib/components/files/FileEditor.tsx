/**
 * @fileType component
 * @domain files
 * @pattern file-editor
 * @ai-summary Monaco Editor in edit mode with save/cancel functionality.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save, X, Eye, SplitSquareHorizontal } from "lucide-react";
import { useFilesContext } from "./FilesContext";
import { detectLanguage } from "@dashboard/lib/repo-files-lang";
import { writeFile } from "@dashboard/lib/repo-files";
import { cn } from "@dashboard/lib/utils";
import { toast } from "sonner";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-white/40 text-sm">
      Loading editor…
    </div>
  ),
});

interface FileEditorProps {
  onCancel: () => void;
  onSaved: () => void;
  onOpenHistory: () => void;
  onPreview: () => void;
  onSplitView: () => void;
  showPreview: boolean;
  showSplit: boolean;
}

export function FileEditor({
  onCancel,
  onSaved,
  onOpenHistory,
  onPreview,
  onSplitView,
  showPreview,
  showSplit: _showSplit,
}: FileEditorProps) {
  const {
    fileContent,
    originalContent,
    setOriginalContent,
    selectedFile,
    currentBranch,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    isSaving,
    setIsSaving,
    setFileContent,
  } = useFilesContext();

  const [localContent, setLocalContent] = useState<string>(originalContent);
  const [showCommitDialog, setShowCommitDialog] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const editorRef = useRef<unknown>(null);

  // Sync local content when original changes
  useEffect(() => {
    setLocalContent(originalContent);
  }, [originalContent]);

  // Warn on unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges && !isSaving) {
          setShowCommitDialog(true);
        }
      }
      if (e.key === "Escape" && hasUnsavedChanges) {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, isSaving]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? "";
      setLocalContent(newContent);
      setHasUnsavedChanges(newContent !== originalContent);
    },
    [originalContent, setHasUnsavedChanges],
  );

  const handleCancel = useCallback(() => {
    if (hasUnsavedChanges) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    setLocalContent(originalContent);
    setHasUnsavedChanges(false);
    onCancel();
  }, [hasUnsavedChanges, originalContent, onCancel, setHasUnsavedChanges]);

  const handleSave = useCallback(async () => {
    if (!selectedFile || !fileContent) return;
    const message = commitMessage.trim() || `Update ${selectedFile.name}`;
    setIsSaving(true);
    try {
      await writeFile({
        path: selectedFile.path,
        content: localContent,
        sha: fileContent.sha,
        message,
        ref: currentBranch,
      });
      setOriginalContent(localContent);
      setHasUnsavedChanges(false);
      setShowCommitDialog(false);
      setCommitMessage("");
      toast.success("File saved");
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedFile,
    fileContent,
    localContent,
    currentBranch,
    commitMessage,
    setIsSaving,
    setOriginalContent,
    setHasUnsavedChanges,
    onSaved,
  ]);

  if (!selectedFile || !fileContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-white/40">No file selected</div>
      </div>
    );
  }

  const language = detectLanguage(selectedFile.name);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">
            {selectedFile.name}
          </span>
          {hasUnsavedChanges && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!showPreview && (
            <button
              type="button"
              onClick={onSplitView}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              title="Split view (edit + preview)"
            >
              <SplitSquareHorizontal className="w-3.5 h-3.5" />
              Split
            </button>
          )}
          <button
            type="button"
            onClick={onPreview}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            title="Preview markdown"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            title="View history"
          >
            History
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-colors"
            title="Cancel (discard changes)"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setShowCommitDialog(true)}
            disabled={!hasUnsavedChanges || isSaving}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors",
              hasUnsavedChanges
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-white/10 text-white/30 cursor-not-allowed",
            )}
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={language}
          value={localContent}
          theme="vs-dark"
          onChange={handleEditorChange}
          options={{
            readOnly: false,
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
            cursorBlinking: "smooth",
            smoothScrolling: true,
          }}
        />
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold mb-3">Commit message</h3>
            <textarea
              autoFocus
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={`Update ${selectedFile.name}`}
              className="w-full h-24 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/90 placeholder:text-white/30 resize-none focus:outline-none focus:border-white/20"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
                if (e.key === "Escape") {
                  setShowCommitDialog(false);
                }
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => setShowCommitDialog(false)}
                className="px-3 py-1.5 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
