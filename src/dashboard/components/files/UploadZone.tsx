/**
 * @fileType component
 * @domain files
 * @pattern upload-zone
 * @ai-summary Drag-and-drop file upload zone with file picker support.
 *   Handles single and multiple file uploads via the GitHub Contents API.
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Loader2, File, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { uploadFile } from "@dashboard/lib/repo-files";
import type { Octokit } from "@octokit/rest";

interface UploadZoneProps {
  octokit: Octokit | null;
  owner: string;
  repo: string;
  onUploadComplete?: (uploaded: {
    path: string;
    size: number;
    sha: string;
  }) => void;
  destinationDir?: string;
}

interface UploadingFile {
  file: File;
  progress: number;
  error?: string;
}

export function UploadZone({
  octokit,
  owner,
  repo,
  onUploadComplete,
  destinationDir = "",
}: UploadZoneProps) {
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [destination, setDestination] = useState(destinationDir);
  const [showDestinationInput, setShowDestinationInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDestination(destinationDir);
  }, [destinationDir]);

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (!octokit) {
        toast.error("Not authenticated");
        return;
      }

      const newUploading: UploadingFile[] = Array.from(files).map((file) => ({
        file,
        progress: 0,
      }));

      setUploading((prev) => [...prev, ...newUploading]);

      for (const uploadingFile of newUploading) {
        const { file } = uploadingFile;

        // Construct destination path
        const baseName = file.webkitRelativePath || file.name;
        const destPath = destination
          ? `${destination.replace(/\/$/, "")}/${baseName}`
          : baseName;

        try {
          const result = await uploadFile(
            octokit,
            owner,
            repo,
            destPath,
            file,
            `chore: upload ${destPath}`,
          );

          toast.success(`Uploaded ${file.name}`);

          // Mark as done
          setUploading((prev) =>
            prev.map((u) => (u.file === file ? { ...u, progress: 100 } : u)),
          );

          // Remove from list after a short delay
          setTimeout(() => {
            setUploading((prev) => prev.filter((u) => u.file !== file));
          }, 1500);

          onUploadComplete?.({
            path: destPath,
            size: file.size,
            sha: result.sha,
          });
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Upload failed";

          toast.error(`Failed to upload ${baseName}: ${errorMessage}`);

          setUploading((prev) =>
            prev.map((u) =>
              u.file === file ? { ...u, error: errorMessage } : u,
            ),
          );
        }
      }
    },
    [octokit, owner, repo, destination, onUploadComplete],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
      // Reset input
      e.target.value = "";
    },
    [handleFiles],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderUploadClick = () => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
    folderInputRef.current?.click();
  };

  const hasActiveUploads = uploading.some((u) => u.progress < 100);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 shrink-0">
        <Upload className="w-4 h-4 text-white/40" />
        <span className="text-sm">Upload files</span>

        <button
          onClick={() => setShowDestinationInput(!showDestinationInput)}
          className={cn(
            "text-xs px-2 py-1 rounded",
            "text-white/50 hover:text-white/70",
          )}
        >
          {showDestinationInput ? "Hide" : "Set destination"}
        </button>

        {hasActiveUploads && (
          <Loader2 className="w-4 h-4 animate-spin text-white/40 ml-auto" />
        )}
      </div>

      {/* Destination input */}
      {showDestinationInput && (
        <div className="px-4 py-2 border-b border-white/5">
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Destination directory (optional)"
            className={cn(
              "w-full text-sm bg-white/5 border border-white/10 rounded px-3 py-1.5",
              "text-white/90 placeholder:text-white/30 outline-none",
            )}
          />
        </div>
      )}

      {/* Drop zone */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col items-center justify-center p-8 m-4",
          "border-2 border-dashed rounded-xl transition-colors",
          isDragging
            ? "border-emerald-500/50 bg-emerald-500/5"
            : "border-white/10 hover:border-white/20",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload
          className={cn(
            "w-10 h-10 mb-4",
            isDragging ? "text-emerald-400" : "text-white/30",
          )}
        />
        <p className="text-sm text-white/60 mb-1">
          {isDragging ? "Drop files here" : "Drag and drop files here"}
        </p>
        <p className="text-xs text-white/30 mb-4">or</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUploadClick}
            className={cn(
              "text-sm px-4 py-2 rounded",
              "bg-white/10 hover:bg-white/15 text-white/80",
            )}
          >
            Browse files
          </button>
          <button
            onClick={handleFolderUploadClick}
            className={cn(
              "text-sm px-4 py-2 rounded",
              "bg-white/10 hover:bg-white/15 text-white/80",
            )}
          >
            Browse folder
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {/* Uploading files list */}
      {uploading.length > 0 && (
        <div className="border-t border-white/10 shrink-0 max-h-40 overflow-y-auto">
          {uploading.map((uploadingFile, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2 border-b border-white/5"
            >
              <File className="w-4 h-4 text-white/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white/70 truncate">
                  {uploadingFile.file.name}
                </div>
                {uploadingFile.error && (
                  <div className="flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="w-3 h-3" />
                    {uploadingFile.error}
                  </div>
                )}
              </div>
              {uploadingFile.progress < 100 && !uploadingFile.error && (
                <Loader2 className="w-4 h-4 animate-spin text-white/40 shrink-0" />
              )}
              {uploadingFile.progress === 100 && (
                <span className="text-xs text-emerald-400">Done</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
