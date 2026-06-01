/**
 * @fileType component
 * @domain files
 * @pattern file-diff-viewer
 * @ai-summary Monaco Diff Editor for viewing file history and comparing commits.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Copy, Check, ChevronDown } from "lucide-react";
import { useFilesContext } from "./FilesContext";
import {
  getCommitsForPath,
  getFileDiff,
  type CommitInfo,
} from "@dashboard/lib/repo-files";
import { cn } from "@dashboard/lib/utils";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-white/40 text-sm">
        Loading diff editor…
      </div>
    ),
  },
);

interface FileDiffViewerProps {
  onClose: () => void;
}

export function FileDiffViewer({ onClose }: FileDiffViewerProps) {
  const { selectedFile, currentBranch } = useFilesContext();

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [baseCommit, setBaseCommit] = useState<string>("");
  const [headCommit, setHeadCommit] = useState<string>("");
  const [diffContent, setDiffContent] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showCommitPicker, setShowCommitPicker] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) return;
    const filePath = selectedFile.path;
    async function load() {
      setLoading(true);
      try {
        const data = await getCommitsForPath(filePath, currentBranch, 30);
        setCommits(data.commits);
        if (data.commits.length >= 2) {
          setBaseCommit(data.commits[1].sha);
          setHeadCommit(data.commits[0].sha);
        } else if (data.commits.length === 1) {
          setBaseCommit(data.commits[0].sha);
          setHeadCommit(data.commits[0].sha);
        }
      } catch (err) {
        console.error("Failed to load commits:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedFile, currentBranch]);

  // Load diff when commits are selected
  useEffect(() => {
    if (!selectedFile || !baseCommit || !headCommit) return;
    const filePath = selectedFile.path;
    if (baseCommit === headCommit) {
      setDiffContent("");
      return;
    }
    async function loadDiff() {
      setDiffLoading(true);
      try {
        const data = await getFileDiff({
          path: filePath,
          base: baseCommit,
          head: headCommit,
          ref: currentBranch,
        });
        setDiffContent(data.patch ?? "");
      } catch (err) {
        console.error("Failed to load diff:", err);
        setDiffContent("");
      } finally {
        setDiffLoading(false);
      }
    }
    loadDiff();
  }, [selectedFile, baseCommit, headCommit, currentBranch]);

  const handleCopyDiff = useCallback(async () => {
    if (!diffContent) return;
    try {
      await navigator.clipboard.writeText(diffContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  }, [diffContent]);

  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-white/40">No file selected</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">
            {selectedFile.name}
          </span>
          <span className="text-xs text-white/40">History</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopyDiff}
            disabled={!diffContent}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
            title="Copy diff"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy diff
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>
      </div>

      {/* Commit picker */}
      <div className="shrink-0 px-4 py-2 border-b border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <label className="text-[10px] text-white/40 mb-1 block">
              Base (older)
            </label>
            <button
              type="button"
              onClick={() => setShowCommitPicker("base")}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-xs text-white/70 hover:border-white/20 transition-colors"
            >
              <span className="truncate">
                {commits.find((c) => c.sha === baseCommit)?.message ??
                  "Select commit"}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>
            {showCommitPicker === "base" && (
              <CommitPicker
                commits={commits}
                selected={baseCommit}
                onSelect={(sha) => {
                  setBaseCommit(sha);
                  setShowCommitPicker(null);
                }}
                onClose={() => setShowCommitPicker(null)}
              />
            )}
          </div>
          <div className="relative flex-1">
            <label className="text-[10px] text-white/40 mb-1 block">
              Head (newer)
            </label>
            <button
              type="button"
              onClick={() => setShowCommitPicker("head")}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-xs text-white/70 hover:border-white/20 transition-colors"
            >
              <span className="truncate">
                {commits.find((c) => c.sha === headCommit)?.message ??
                  "Select commit"}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>
            {showCommitPicker === "head" && (
              <CommitPicker
                commits={commits}
                selected={headCommit}
                onSelect={(sha) => {
                  setHeadCommit(sha);
                  setShowCommitPicker(null);
                }}
                onClose={() => setShowCommitPicker(null)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-white/40 animate-pulse">
              Loading history…
            </div>
          </div>
        ) : diffLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-white/40 animate-pulse">
              Loading diff…
            </div>
          </div>
        ) : baseCommit === headCommit ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-white/40">
              Select two different commits to compare
            </div>
          </div>
        ) : diffContent ? (
          <DiffEditor
            height="100%"
            language="plaintext"
            original={getOriginalFromPatch(diffContent)}
            modified={getModifiedFromPatch(diffContent)}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              automaticLayout: true,
              padding: { top: 8, bottom: 8 },
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-white/40">No diff available</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Commit picker dropdown
function CommitPicker({
  commits,
  selected,
  onSelect,
  onClose,
}: {
  commits: CommitInfo[];
  selected: string;
  onSelect: (sha: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-md shadow-xl z-50 max-h-48 overflow-y-auto">
        {commits.map((c) => (
          <button
            key={c.sha}
            type="button"
            onClick={() => onSelect(c.sha)}
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs transition-colors",
              c.sha === selected
                ? "bg-white/[0.08] text-white/90"
                : "text-white/60 hover:bg-white/[0.05]",
            )}
          >
            <div className="truncate font-mono text-[10px] text-white/30">
              {c.sha.slice(0, 7)}
            </div>
            <div className="truncate">{c.message}</div>
            <div className="text-[10px] text-white/30">
              {c.author} · {new Date(c.date).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

// Parse unified diff patch to get original and modified content
function getOriginalFromPatch(patch: string): string {
  return patch
    .split("\n")
    .filter(
      (l) => !l.startsWith("+") && !l.startsWith("@@") && !l.startsWith("\\"),
    )
    .map((l) => (l.startsWith("-") ? l.slice(1) : l))
    .join("\n");
}

function getModifiedFromPatch(patch: string): string {
  return patch
    .split("\n")
    .filter(
      (l) => !l.startsWith("-") && !l.startsWith("@@") && !l.startsWith("\\"),
    )
    .map((l) => (l.startsWith("+") ? l.slice(1) : l))
    .join("\n");
}
