/**
 * @fileType component
 * @domain kody
 * @pattern state-file-view-page
 * @ai-summary Read-only viewer for runtime state files stored in kody-state.
 */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";
import { Copy, ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dashboard/ui/button";
import { buildKodyAuthHeaders } from "../auth-headers";
import { useAuth } from "../auth-context";
import { ApiError, handleResponse } from "../api";
import { monacoLanguage } from "../repo-files-lang";
import { PageShell } from "./PageShell";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    ),
  },
) as React.ComponentType<EditorProps>;

type StateFilePayload = {
  requestedPath: string;
  path: string;
  content: string;
  sha: string;
  htmlUrl: string | null;
  size: number;
};

interface StateFilePageProps {
  initialPath: string;
}

function normalizeViewerPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function StateFilePage({ initialPath }: StateFilePageProps) {
  const { auth } = useAuth();
  const requestedPath = useMemo(
    () => normalizeViewerPath(initialPath),
    [initialPath],
  );
  const [file, setFile] = useState<StateFilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async () => {
    if (!requestedPath) {
      setError("No state file selected");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ path: requestedPath });
      const res = await fetch(`/api/kody/state-files?${params}`, {
        headers: buildKodyAuthHeaders(auth),
      });
      const payload = await handleResponse<StateFilePayload>(res);
      setFile(payload);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? "State file not found"
          : err instanceof Error
            ? err.message
            : "Failed to load state file";
      setError(message);
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [auth, requestedPath]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleCopy = useCallback(() => {
    if (!file) return;
    navigator.clipboard.writeText(file.content).then(() => {
      toast.success("Copied to clipboard");
    });
  }, [file]);

  const fileName = requestedPath.split("/").pop() ?? requestedPath;
  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        disabled={!file}
        title="Copy file content"
        aria-label="Copy file content"
      >
        <Copy className="h-4 w-4" />
      </Button>
      {file?.htmlUrl ? (
        <Button
          variant="ghost"
          size="icon"
          asChild
          title="Open source file"
          aria-label="Open source file"
        >
          <a href={file.htmlUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ) : null}
    </div>
  );

  return (
    <PageShell
      title="State Evidence"
      icon={FileText}
      subtitle={requestedPath ? `/${requestedPath}` : undefined}
      backHref="/agency-runs"
      actions={actions}
      width="full"
      contentClassName="p-0"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
          <span className="truncate text-sm font-medium">{fileName}</span>
          <span className="truncate font-mono text-xs text-white/45">
            {file?.path ?? requestedPath}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-white/45">
            {file?.sha ? (
              <span className="font-mono">{file.sha.slice(0, 7)}</span>
            ) : null}
            {file ? <span>{formatBytes(file.size)}</span> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center text-white/45">
              <FileText className="mb-2 h-8 w-8" />
              <span>{error}</span>
            </div>
          ) : file ? (
            <MonacoEditor
              height="100%"
              language={monacoLanguage(requestedPath)}
              value={file.content}
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
    </PageShell>
  );
}
