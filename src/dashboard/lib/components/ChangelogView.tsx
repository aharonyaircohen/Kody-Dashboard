/**
 * @fileType component
 * @domain kody
 * @pattern changelog-page
 * @ai-summary Renders CHANGELOG.md from the connected repo. The file is
 *   maintained automatically by webhook handlers — appended on merge,
 *   promoted on release. Read-only UI; no edits from the dashboard.
 */
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileText, RefreshCw } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { AuthGuard } from "../auth-guard";
import { useChangelog } from "../hooks/useChangelog";
import { PageHeader } from "./PageShell";

interface ChangelogViewProps {
  /** Render without the built-in PageHeader (e.g. when hosted in DutiesPageTabs). */
  embedded?: boolean;
}

export function ChangelogView({ embedded = false }: ChangelogViewProps = {}) {
  return (
    <AuthGuard>
      <ChangelogViewInner embedded={embedded} />
    </AuthGuard>
  );
}

function ChangelogViewInner({ embedded = false }: ChangelogViewProps) {
  const { data, isLoading, isFetching, refetch, error } = useChangelog();

  const content = data?.content ?? "";
  const htmlUrl = data?.htmlUrl ?? null;
  const hasContent = content.trim().length > 0;

  const body = (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
          <h2 className="text-sm font-medium truncate">CHANGELOG.md</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
            aria-label="Refresh changelog"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {htmlUrl ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={htmlUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">View on GitHub</span>
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Loading changelog…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-dashed border-red-500/30 bg-red-500/5 py-8 text-center space-y-2">
              <p className="text-sm font-medium text-red-400">
                Could not load CHANGELOG.md
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
          ) : hasContent ? (
            <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                No changelog yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                CHANGELOG.md will be created automatically the first time a PR
                is merged. Each merge appends a bullet under{" "}
                <code>## [Unreleased]</code>; publishing a GitHub release
                promotes that section to a versioned entry.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader title="Changelog" />
      {body}
    </div>
  );
}
