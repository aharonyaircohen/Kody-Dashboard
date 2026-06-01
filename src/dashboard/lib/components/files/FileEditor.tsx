/**
 * @fileType component
 * @domain kody
 * @pattern file-editor
 * @ai-summary Component for editing file contents with save functionality
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Save, X, Loader2, RotateCcw, Check, AlertCircle } from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type FileItem } from "./FilesContext";

interface FileEditorProps {
  file: FileItem | null;
  onSave?: (content: string) => void;
  className?: string;
}

export function FileEditor({ file, onSave, className }: FileEditorProps) {
  const { currentBranch } = useFiles();
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!file || file.type === "dir") {
      setContent("");
      setOriginalContent("");
      return;
    }

    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      setSaved(false);

      try {
        const params = new URLSearchParams({ path: file.path });
        if (currentBranch) params.set("ref", currentBranch);

        const res = await fetch(`/api/kody/files/contents?${params}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch file");
        }

        const data = await res.json();
        const fetchedContent = data.content || "";
        setContent(fetchedContent);
        setOriginalContent(fetchedContent);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [file, currentBranch]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!file || saving) return;

    setSaving(true);
    setError(null);

    try {
      // Create/update file via GitHub API
      const response = await fetch(
        `/api/kody/files?path=${encodeURIComponent(file.path)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            message: `Update ${file.path}`,
            branch: currentBranch,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save file");
      }

      setOriginalContent(content);
      setSaved(true);
      onSave?.(content);

      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setContent(originalContent);
    setSaved(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    // Cmd/Ctrl + Z to reset
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      handleReset();
    }
  };

  const hasChanges = content !== originalContent;

  if (!file) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-muted-foreground",
          className,
        )}
      >
        <p className="text-sm">Select a file to edit</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-destructive",
          className,
        )}
      >
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{file.name}</span>
          {hasChanges && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
              Modified
            </span>
          )}
          {saved && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className={cn(
              "p-1.5 rounded transition-colors",
              hasChanges
                ? "hover:bg-accent text-muted-foreground"
                : "text-muted-foreground/30 cursor-not-allowed",
            )}
            title="Reset changes (Ctrl+Z)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={cn(
              "p-1.5 rounded transition-colors",
              hasChanges && !saving
                ? "hover:bg-accent text-green-600 dark:text-green-400"
                : "text-muted-foreground/30 cursor-not-allowed",
            )}
            title="Save (Ctrl+S)"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full h-full p-4 font-mono text-xs leading-5",
            "bg-zinc-950/50 text-zinc-200",
            "resize-none focus:outline-none",
            "placeholder:text-zinc-600",
          )}
          placeholder="File content..."
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1 border-t bg-muted/20 text-xs text-muted-foreground">
        <span>
          {content.length} characters, {content.split("\n").length} lines
        </span>
        <span>
          {currentBranch || "default"} / {file.path}
        </span>
      </div>
    </div>
  );
}
