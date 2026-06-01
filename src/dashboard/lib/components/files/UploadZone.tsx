/**
 * @fileType component
 * @domain files
 * @pattern upload-zone
 * @ai-summary Drag-and-drop upload zone for the file browser.
 */
"use client";

import { useCallback, useState, useRef } from "react";
import { Upload, FileUp, AlertCircle } from "lucide-react";
import { useFilesContext } from "./FilesContext";
import { toast } from "sonner";

interface UploadZoneProps {
  children: React.ReactNode;
}

export function UploadZone({ children }: UploadZoneProps) {
  const { currentPath, currentBranch, refreshTree } = useFilesContext();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const basePath = currentPath;
      const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
      setUploading(true);
      setError(null);
      try {
        const content = await file.arrayBuffer();
        const base64 = Buffer.from(content).toString("base64");
        const res = await fetch("/api/kody/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "write",
            path: fullPath,
            content: base64,
            message: `Upload ${file.name}`,
            ref: currentBranch,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Upload failed");
        }
        toast.success(`Uploaded ${file.name}`);
        refreshTree();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        toast.error(msg);
      } finally {
        setUploading(false);
        setProgress(null);
      }
    },
    [currentPath, currentBranch, refreshTree],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      for (const file of files) {
        await uploadFile(file);
      }
    },
    [uploadFile],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      for (const file of files) {
        await uploadFile(file);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFile],
  );

  return (
    <div
      className="relative flex-1 h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 bg-black/80 border-2 border-dashed border-emerald-500/50 rounded-lg flex items-center justify-center z-30 pointer-events-none">
          <div className="text-center">
            <FileUp className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-emerald-300">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30">
          <div className="text-center">
            <Upload className="w-8 h-8 text-emerald-400 mx-auto mb-2 animate-pulse" />
            <p className="text-sm text-white/70">Uploading…</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="absolute bottom-4 left-4 right-4 bg-rose-950/80 border border-rose-500/30 rounded-lg px-4 py-2 flex items-center gap-2 z-30">
          <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          <span className="text-xs text-rose-200">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto text-rose-300 hover:text-rose-200"
          >
            ×
          </button>
        </div>
      )}

      {/* Hidden file input for click-to-upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
