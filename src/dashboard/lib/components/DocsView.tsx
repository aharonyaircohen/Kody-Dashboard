/**
 * @fileType component
 * @domain docs
 * @pattern docs-page
 * @ai-summary Renders README.md and nested markdown files under docs/ from
 *   the connected repo. Left sidebar renders a docs tree; selecting a file
 *   renders its markdown. Read-only UI; no edits from the dashboard.
 */
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@dashboard/ui/button";
import { cn } from "@dashboard/lib/utils";
import { AuthGuard } from "../auth-guard";
import { useDocsManifest, useDoc } from "../hooks/useDocs";
import { PageHeader } from "./PageShell";
import type { DocManifestEntry } from "../api";

interface DocsViewProps {
  /** Render without the built-in PageHeader (e.g. when embedded). */
  embedded?: boolean;
}

interface DocTreeNode {
  entry: DocManifestEntry;
  children: DocTreeNode[];
}

export function firstDocFilePath(
  files: DocManifestEntry[] | undefined,
): string | null {
  return files?.find((file) => file.type === "file")?.path ?? null;
}

function parentPath(path: string): string {
  if (!path.includes("/")) return "";
  return path.slice(0, path.lastIndexOf("/"));
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function addChild(
  parent: DocTreeNode | null,
  child: DocTreeNode,
  roots: DocTreeNode[],
) {
  const siblings = parent ? parent.children : roots;
  if (!siblings.some((node) => node.entry.path === child.entry.path)) {
    siblings.push(child);
  }
}

export function buildDocTree(files: DocManifestEntry[]): DocTreeNode[] {
  const roots: DocTreeNode[] = [];
  const byPath = new Map<string, DocTreeNode>();

  const ensureFolder = (path: string): DocTreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;

    const node: DocTreeNode = {
      entry: { name: basename(path), path, type: "folder", htmlUrl: null },
      children: [],
    };
    byPath.set(path, node);

    const parent = parentPath(path);
    addChild(parent ? ensureFolder(parent) : null, node, roots);
    return node;
  };

  for (const file of files) {
    if (file.type === "folder") {
      const folder = ensureFolder(file.path);
      folder.entry = file;
      continue;
    }

    const node: DocTreeNode = { entry: file, children: [] };
    byPath.set(file.path, node);
    const parent = parentPath(file.path);
    addChild(parent ? ensureFolder(parent) : null, node, roots);
  }

  const sortNodes = (nodes: DocTreeNode[]): DocTreeNode[] =>
    [...nodes]
      .sort((a, b) => {
        if (a.entry.path === "README.md") return -1;
        if (b.entry.path === "README.md") return 1;
        if (a.entry.type !== b.entry.type) {
          return a.entry.type === "folder" ? -1 : 1;
        }
        return (
          a.entry.name.localeCompare(b.entry.name) ||
          a.entry.path.localeCompare(b.entry.path)
        );
      })
      .map((node) => ({ ...node, children: sortNodes(node.children) }));

  return sortNodes(roots);
}

export function DocsView({ embedded = false }: DocsViewProps = {}) {
  return (
    <AuthGuard>
      <DocsViewInner embedded={embedded} />
    </AuthGuard>
  );
}

function DocsViewInner({ embedded = false }: DocsViewProps) {
  const {
    data: manifest,
    isLoading: manifestLoading,
    refetch: refetchManifest,
  } = useDocsManifest();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const docPath = selectedPath ?? firstDocFilePath(manifest?.files);

  const {
    data: doc,
    isLoading: docLoading,
    isFetching: docFetching,
    refetch: refetchDoc,
    error,
  } = useDoc(docPath ?? "");

  const content = doc?.content ?? "";
  const htmlUrl = doc?.htmlUrl ?? null;
  const docName = doc?.name ?? docPath ?? "Docs";
  const hasContent = content.trim().length > 0;

  const handleRefresh = () => {
    refetchManifest();
    if (docPath) refetchDoc();
  };

  const sidebar = (
    <div className="h-full flex flex-col overflow-hidden border-r border-white/[0.06]">
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-black/30">
        <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="text-sm font-medium">Docs</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {manifestLoading ? (
          <div className="px-4 py-6 text-xs text-muted-foreground text-center">
            Loading…
          </div>
        ) : manifest?.files && manifest.files.length > 0 ? (
          <DocList
            files={manifest.files}
            selectedPath={docPath}
            onSelect={setSelectedPath}
          />
        ) : (
          <div className="px-4 py-6 text-xs text-muted-foreground text-center">
            No docs found
          </div>
        )}
      </div>
    </div>
  );

  const main = (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-sm font-medium truncate">{docName}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={docFetching}
            className="gap-1.5"
            aria-label="Refresh docs"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${docFetching ? "animate-spin" : ""}`}
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
          {!docPath ? (
            <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Select a doc to read it
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Choose a file from the sidebar on the left.
              </p>
            </div>
          ) : docLoading ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Loading…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-dashed border-red-500/30 bg-red-500/5 py-8 text-center space-y-2">
              <p className="text-sm font-medium text-red-400">
                Could not load doc
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
              <p className="text-sm font-medium text-foreground">Empty doc</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                This file has no content yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full overflow-hidden">
        {sidebar}
        <div className="flex-1 min-w-0 overflow-hidden">{main}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader title="Docs" />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {sidebar}
        <div className="flex-1 min-w-0 overflow-hidden">{main}</div>
      </div>
    </div>
  );
}

function DocList({
  files,
  selectedPath,
  onSelect,
}: {
  files: DocManifestEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const tree = buildDocTree(files);

  const toggleFolder = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <ul className="space-y-0.5 px-1" role="tree">
      {tree.map((node) => (
        <DocTreeRow
          key={node.entry.path}
          node={node}
          depth={0}
          collapsedPaths={collapsedPaths}
          selectedPath={selectedPath}
          onToggleFolder={toggleFolder}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function DocTreeRow({
  node,
  depth,
  collapsedPaths,
  selectedPath,
  onToggleFolder,
  onSelect,
}: {
  node: DocTreeNode;
  depth: number;
  collapsedPaths: Set<string>;
  selectedPath: string | null;
  onToggleFolder: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isFolder = node.entry.type === "folder";
  const isOpen = isFolder && !collapsedPaths.has(node.entry.path);
  const isSelected = !isFolder && node.entry.path === selectedPath;
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li>
      <button
        type="button"
        title={node.entry.path}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={!isFolder ? isSelected : undefined}
        onClick={() =>
          isFolder ? onToggleFolder(node.entry.path) : onSelect(node.entry.path)
        }
        className={cn(
          "w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-left transition-colors text-sm select-none",
          isSelected
            ? "bg-white/[0.08] text-foreground"
            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {isFolder ? (
          isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-white/50 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isFolder ? (
          <FolderIcon className="w-4 h-4 text-amber-300 shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-sky-300 shrink-0" />
        )}
        <span className="truncate">{node.entry.name}</span>
      </button>
      {isFolder && isOpen && node.children.length > 0 ? (
        <ul role="group">
          {node.children.map((child) => (
            <DocTreeRow
              key={child.entry.path}
              node={child}
              depth={depth + 1}
              collapsedPaths={collapsedPaths}
              selectedPath={selectedPath}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
