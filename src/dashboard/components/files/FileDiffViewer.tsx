/**
 * @fileType component
 * @domain files
 * @pattern file-diff-viewer
 * @ai-summary Monaco DiffEditor for comparing file versions between commits.
 *   Shows a list of recent commits and allows selecting two to compare.
 */
"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { DiffEditorProps } from "@monaco-editor/react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import {
  commitsForPath,
  getFileAtRef,
  type CommitInfo,
} from "@dashboard/lib/repo-files";
import type { Octokit } from "@octokit/rest";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    ),
  },
) as React.ComponentType<DiffEditorProps>;

interface FileDiffViewerProps {
  path: string;
  octokit: Octokit | null;
  owner: string;
  repo: string;
  onClose: () => void;
}

export function FileDiffViewer({
  path,
  octokit,
  owner,
  repo,
  onClose,
}: FileDiffViewerProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [leftCommit, setLeftCommit] = useState<CommitInfo | null>(null);
  const [rightCommit, setRightCommit] = useState<CommitInfo | null>(null);
  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);

  // Load commit history
  useEffect(() => {
    if (!octokit) return;
    const load = async () => {
      try {
        const history = await commitsForPath(octokit, owner, repo, path, 20);
        setCommits(history);
        if (history.length >= 2) {
          setLeftCommit(history[1]);
          setRightCommit(history[0]);
        } else if (history.length === 1) {
          setLeftCommit(history[0]);
          setRightCommit(null);
        }
      } catch (err) {
        console.error("Failed to load commit history", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [octokit, owner, repo, path]);

  // Load content for selected commits
  const loadDiffContent = useCallback(async () => {
    if (!octokit || !leftCommit || !rightCommit) return;
    setLoadingContent(true);
    try {
      const [left, right] = await Promise.all([
        getFileAtRef(octokit, owner, repo, path, leftCommit.sha),
        getFileAtRef(octokit, owner, repo, path, rightCommit.sha),
      ]);
      setLeftContent(left?.content ?? "");
      setRightContent(right?.content ?? "");
    } catch (err) {
      console.error("Failed to load diff content", err);
    } finally {
      setLoadingContent(false);
    }
  }, [octokit, owner, repo, path, leftCommit, rightCommit]);

  // Load diff when commits change
  useEffect(() => {
    loadDiffContent();
  }, [loadDiffContent]);

  const handleCopyDiff = () => {
    const diff = `--- a/${path}\n+++ b/${path}\n${rightContent}`;
    navigator.clipboard.writeText(diff).then(() => {
      toast.success("Diff copied to clipboard");
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 shrink-0">
        <span className="text-sm font-medium truncate">{path}</span>
        <span className="text-xs text-white/40">Diff view</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleCopyDiff}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded",
              "text-white/60 hover:text-white/90 hover:bg-white/10",
            )}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy diff
          </button>
          <button
            onClick={onClose}
            className={cn(
              "text-xs px-2 py-1 rounded",
              "text-white/60 hover:text-white/90 hover:bg-white/10",
            )}
          >
            Close
          </button>
        </div>
      </div>

      {/* Commit selector */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">Compare:</span>
          <select
            value={leftCommit?.sha ?? ""}
            onChange={(e) => {
              const sha = e.target.value;
              setLeftCommit(commits.find((c) => c.sha === sha) ?? null);
            }}
            className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70"
          >
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {c.sha} — {c.message.slice(0, 40)}
              </option>
            ))}
          </select>

          <span className="text-white/30">→</span>

          <select
            value={rightCommit?.sha ?? ""}
            onChange={(e) => {
              const sha = e.target.value;
              setRightCommit(commits.find((c) => c.sha === sha) ?? null);
            }}
            className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70"
          >
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {c.sha} — {c.message.slice(0, 40)}
              </option>
            ))}
          </select>
        </div>

        {loadingContent && (
          <Loader2 className="w-4 h-4 animate-spin text-white/40 ml-2" />
        )}
      </div>

      {/* Diff editor */}
      <div className="flex-1 min-h-0">
        {leftContent && rightContent ? (
          <DiffEditor
            height="100%"
            language="plaintext"
            original={leftContent}
            modified={rightContent}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              automaticLayout: true,
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white/40">
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <span>Select two commits to compare</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
