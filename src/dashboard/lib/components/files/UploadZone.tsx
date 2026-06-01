/**
 * @fileType component
 * @domain kody
 * @pattern upload-zone
 * @ai-summary Component for uploading files to the repository
 */
"use client";

import { useState, useCallback } from "react";
import { Upload, X, Loader2, Check, AlertCircle, FileIcon } from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles } from "./FilesContext";

interface UploadZoneProps {
  targetPath?: string;
  onUploadComplete?: (file: { name: string; path: string }) => void;
  onError?: (error: string) => void;
  className?: string;
}

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "complete" | "error";
  error?: string;
}

export function UploadZone({
  targetPath = "",
  onUploadComplete,
  onError,
  className,
}: UploadZoneProps) {
  const { currentBranch } = useFiles();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<UploadingFile[]>([]);

  const uploadFile = useCallback(
    async (file: File) => {
      const reader = new FileReader();

      return new Promise<void>((resolve, reject) => {
        reader.onload = async () => {
          try {
            const content = reader.result as string;
            // Extract base64 content
            const base64Content = content.split(",")[1] || content;

            const filePath = targetPath
              ? `${targetPath}/${file.name}`.replace(/\/+/g, "/")
              : file.name;

            const response = await fetch("/api/kody/files", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                path: filePath,
                content: base64Content,
                message: `Upload ${file.name}`,
                branch: currentBranch,
              }),
            });

            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || "Upload failed");
            }

            onUploadComplete?.({ name: file.name, path: filePath });
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
    },
    [targetPath, currentBranch, onUploadComplete],
  );

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      setUploading(true);

      const newFiles: UploadingFile[] = Array.from(fileList).map((file) => ({
        file,
        progress: 0,
        status: "uploading" as const,
      }));

      setFiles((prev) => [...prev, ...newFiles]);

      for (let i = 0; i < newFiles.length; i++) {
        const uploadingFile = newFiles[i];
        try {
          await uploadFile(uploadingFile.file);
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === prev.length - newFiles.length + i
                ? { ...f, status: "complete" as const, progress: 100 }
                : f,
            ),
          );
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Upload failed";
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === prev.length - newFiles.length + i
                ? { ...f, status: "error" as const, error: errorMessage }
                : f,
            ),
          );
          onError?.(errorMessage);
        }
      }

      setUploading(false);
    },
    [uploadFile, onError],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleRemove = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg",
          "transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
        )}
      >
        <input
          type="file"
          multiple
          onChange={handleInputChange}
          className="hidden"
          id="file-upload-input"
        />
        <label
          htmlFor="file-upload-input"
          className="flex flex-col items-center cursor-pointer"
        >
          <Upload
            className={cn(
              "w-8 h-8 mb-2",
              dragOver ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="text-sm text-muted-foreground">
            {dragOver ? "Drop files here" : "Click or drag files to upload"}
          </span>
          <span className="text-xs text-muted-foreground/60 mt-1">
            Uploading to {targetPath || "/"} on{" "}
            {currentBranch || "default branch"}
          </span>
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((uploadingFile, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
            >
              <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  {uploadingFile.file.name}
                </div>
                {uploadingFile.error && (
                  <div className="text-xs text-destructive">
                    {uploadingFile.error}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {uploadingFile.status === "uploading" && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
                {uploadingFile.status === "complete" && (
                  <Check className="w-4 h-4 text-green-500" />
                )}
                {uploadingFile.status === "error" && (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
              </div>
              <button
                onClick={() => handleRemove(index)}
                className="p-1 rounded hover:bg-accent"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
