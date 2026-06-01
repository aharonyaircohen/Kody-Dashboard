/**
 * @fileType component
 * @domain kody
 * @pattern file-viewer
 * @ai-summary Component for viewing file contents with syntax highlighting
 */
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Download,
  ExternalLink,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type FileItem } from "./FilesContext";
import hljs from "highlight.js/lib/common";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile",
};

function detectLanguage(filename: string): string | null {
  const base = filename.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  const ext = base.split(".").pop();
  if (!ext) return null;
  const lang = EXT_TO_LANG[ext];
  if (!lang) return null;
  return hljs.getLanguage(lang) ? lang : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface FileViewerProps {
  file: FileItem | null;
  className?: string;
}

export function FileViewer({ file, className }: FileViewerProps) {
  const { currentBranch } = useFiles();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!file || file.type === "dir") {
      setContent(null);
      return;
    }

    const fetchContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ path: file.path });
        if (currentBranch) params.set("ref", currentBranch);

        const res = await fetch(`/api/kody/files/contents?${params}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch file");
        }

        const data = await res.json();
        setContent(data.content || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [file, currentBranch]);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!file?.download_url) return;
    window.open(file.download_url, "_blank");
  };

  const handleOpenGitHub = () => {
    if (!file?.path) return;
    const url = `https://github.com/${file.path}`;
    window.open(url, "_blank");
  };

  const lang = useMemo(() => (file ? detectLanguage(file.name) : null), [file]);

  const highlightedContent = useMemo(() => {
    if (!content) return "";
    if (!lang) return escapeHtml(content);

    try {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true })
        .value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, lang]);

  const lines = content ? content.split("\n") : [];

  if (!file) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-muted-foreground",
          className,
        )}
      >
        <FileText className="w-12 h-12 mb-2 opacity-20" />
        <p className="text-sm">Select a file to view</p>
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
        <p className="text-sm">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{file.name}</span>
          {lang && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {lang}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-accent transition-colors"
            title="Copy content"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
          {file.download_url && (
            <button
              onClick={handleDownload}
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="Download"
            >
              <Download className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={handleOpenGitHub}
            className="p-1.5 rounded hover:bg-accent transition-colors"
            title="Open on GitHub"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-zinc-950/50">
        {content === "" ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Empty file
          </div>
        ) : (
          <pre className="p-0 m-0">
            <code className="font-mono text-xs leading-5 block">
              {lines.map((line, i) => (
                <span key={i} className="flex">
                  <span className="w-12 shrink-0 select-none text-right pr-4 text-zinc-600 border-r border-zinc-800 bg-zinc-900/50">
                    {i + 1}
                  </span>
                  <span
                    className="px-4 whitespace-pre"
                    dangerouslySetInnerHTML={{
                      __html:
                        lang && highlightedContent
                          ? highlightedContent
                              .split("\n")
                              [
                                i
                              ]?.replace(/<span class="hljs-.*?">|<\/span>/g, "") ||
                            escapeHtml(line)
                          : escapeHtml(line),
                    }}
                  />
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}
