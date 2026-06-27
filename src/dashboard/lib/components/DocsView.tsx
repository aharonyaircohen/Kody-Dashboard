/**
 * @fileType component
 * @domain docs
 * @pattern docs-page
 * @ai-summary Renders and manages README.md plus nested markdown files under
 *   docs/ from the connected repo. Left sidebar renders a docs tree; selecting
 *   a file renders its markdown.
 */
"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils";
import { AuthGuard } from "../auth-guard";
import { selectionPathFromParts } from "../selection-routing";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  useCreateDoc,
  useDeleteDoc,
  useDocsManifest,
  useDoc,
  useUpdateDoc,
} from "../hooks/useDocs";
import { PageHeader } from "./PageShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownPreview } from "./MarkdownPreview";
import type { DocManifestEntry } from "../api";

interface DocsViewProps {
  /** Render without the built-in PageHeader (e.g. when embedded). */
  embedded?: boolean;
  selectedPath?: string | null;
}

interface DocTreeNode {
  entry: DocManifestEntry;
  children: DocTreeNode[];
}

interface DocFormState {
  mode: "create" | "edit";
  originalPath: string | null;
  path: string;
  content: string;
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

function nextDocPath(files: DocManifestEntry[] | undefined): string {
  const used = new Set(files?.map((file) => file.path) ?? []);
  let candidate = "docs/new-doc.md";
  let i = 2;
  while (used.has(candidate)) {
    candidate = `docs/new-doc-${i}.md`;
    i += 1;
  }
  return candidate;
}

function docRoute(path: string | null): string {
  if (!path) return "/docs";
  return selectionPathFromParts(
    "/docs",
    path.split("/").filter((part) => part.length > 0),
  );
}

function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Docs update failed";
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

export function DocsView({
  embedded = false,
  selectedPath = null,
}: DocsViewProps = {}) {
  return (
    <AuthGuard>
      <DocsViewInner embedded={embedded} selectedPath={selectedPath} />
    </AuthGuard>
  );
}

function DocsViewInner({ embedded = false, selectedPath = null }: DocsViewProps) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const {
    data: manifest,
    isLoading: manifestLoading,
    refetch: refetchManifest,
  } = useDocsManifest();
  const docPath =
    selectedPath ?? (autoSelectFirst ? firstDocFilePath(manifest?.files) : null);
  const hasSelectedDoc = !!docPath;

  const {
    data: doc,
    isLoading: docLoading,
    isFetching: docFetching,
    refetch: refetchDoc,
    error,
  } = useDoc(docPath ?? "");
  const createDocMutation = useCreateDoc();
  const updateDocMutation = useUpdateDoc();
  const deleteDocMutation = useDeleteDoc();
  const [docForm, setDocForm] = useState<DocFormState | null>(null);
  const [deletePath, setDeletePath] = useState<string | null>(null);

  const content = doc?.content ?? "";
  const htmlUrl = doc?.htmlUrl ?? null;
  const docName = doc?.name ?? docPath ?? "Docs";
  const hasContent = content.trim().length > 0;
  const isSaving = createDocMutation.isPending || updateDocMutation.isPending;

  useEffect(() => {
    if (manifestLoading || manifest === undefined) return;
    const firstPath = firstDocFilePath(manifest?.files);
    if (!firstPath) {
      if (selectedPath) router.replace("/docs");
      return;
    }
    if (
      selectedPath &&
      !manifest?.files?.some(
        (file) => file.type === "file" && file.path === selectedPath,
      )
    ) {
      router.replace("/docs");
      return;
    }
    if (!selectedPath && autoSelectFirst) {
      router.replace(docRoute(firstPath));
    }
  }, [
    autoSelectFirst,
    manifest,
    manifest?.files,
    manifestLoading,
    router,
    selectedPath,
  ]);

  const selectDoc = (path: string | null, replace = false) => {
    const route = docRoute(path);
    if (replace) router.replace(route);
    else router.push(route);
  };

  const handleRefresh = () => {
    refetchManifest();
    if (docPath) refetchDoc();
  };

  const openCreate = () => {
    setDocForm({
      mode: "create",
      originalPath: null,
      path: nextDocPath(manifest?.files),
      content: "# New Doc\n",
    });
  };

  const openEdit = () => {
    if (!docPath) return;
    setDocForm({
      mode: "edit",
      originalPath: docPath,
      path: docPath,
      content,
    });
  };

  const submitDocForm = async () => {
    if (!docForm) return;
    const nextPath = docForm.path.trim();
    if (!nextPath) {
      toast.error("Path is required");
      return;
    }

    try {
      const saved =
        docForm.mode === "create"
          ? await createDocMutation.mutateAsync({
              path: nextPath,
              content: docForm.content,
            })
          : await updateDocMutation.mutateAsync({
              path: docForm.originalPath ?? nextPath,
              newPath:
                docForm.originalPath && nextPath !== docForm.originalPath
                  ? nextPath
                  : undefined,
              content: docForm.content,
            });

      selectDoc(saved.path);
      setDocForm(null);
      toast.success(docForm.mode === "create" ? "Doc created" : "Doc saved");
    } catch (err) {
      toast.error(mutationErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!deletePath) return;
    try {
      await deleteDocMutation.mutateAsync(deletePath);
      if (selectedPath === deletePath) selectDoc(null, true);
      setDeletePath(null);
      toast.success("Doc deleted");
      refetchManifest();
    } catch (err) {
      toast.error(mutationErrorMessage(err));
    }
  };

  const sidebar = (
    <div className="h-full flex flex-col overflow-hidden md:border-r md:border-white/[0.06]">
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium truncate">Docs</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 gap-1.5"
          onClick={openCreate}
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
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
            onSelect={selectDoc}
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
          {docPath ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="md:hidden -ml-2 h-8 px-2 gap-1 text-muted-foreground"
              onClick={() => selectDoc(null)}
              aria-label="Back to docs list"
            >
              <ArrowLeft className="w-4 h-4" />
              Docs
            </Button>
          ) : null}
          <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-sm font-medium truncate">{docName}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={openEdit}
            disabled={!docPath || docLoading}
            className="gap-1.5"
            aria-label="Edit doc"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => docPath && setDeletePath(docPath)}
            disabled={!docPath || deleteDocMutation.isPending}
            className="gap-1.5 text-red-300 hover:text-red-200"
            aria-label="Delete doc"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
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
            <MarkdownPreview
              content={content}
              className="md:prose-base break-words"
            />
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

  const dialogs = (
    <>
      <DocEditorDialog
        state={docForm}
        onChange={setDocForm}
        onClose={() => setDocForm(null)}
        onSubmit={submitDocForm}
        isSaving={isSaving}
      />
      <ConfirmDialog
        open={!!deletePath}
        title="Delete doc"
        description={deletePath ? `Delete ${deletePath}?` : "Delete this doc?"}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          void confirmDelete();
        }}
        onClose={() => setDeletePath(null)}
      />
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="flex h-full overflow-hidden">
          <div
            className={cn(
              "w-full shrink-0 md:w-80",
              hasSelectedDoc && "hidden md:block",
            )}
          >
            {sidebar}
          </div>
          <div
            className={cn(
              "flex-1 min-w-0 overflow-hidden",
              !hasSelectedDoc && "hidden md:block",
            )}
          >
            {main}
          </div>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader title="Docs" />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className={cn(
            "w-full shrink-0 md:w-80",
            hasSelectedDoc && "hidden md:block",
          )}
        >
          {sidebar}
        </div>
        <div
          className={cn(
            "flex-1 min-w-0 overflow-hidden",
            !hasSelectedDoc && "hidden md:block",
          )}
        >
          {main}
        </div>
      </div>
      {dialogs}
    </div>
  );
}

function DocEditorDialog({
  state,
  onChange,
  onClose,
  onSubmit,
  isSaving,
}: {
  state: DocFormState | null;
  onChange: (state: DocFormState | null) => void;
  onClose: () => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  return (
    <Dialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "create" ? "New doc" : "Edit doc"}
          </DialogTitle>
        </DialogHeader>
        {state ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Path
              </span>
              <Input
                value={state.path}
                onChange={(event) =>
                  onChange({ ...state, path: event.target.value })
                }
                placeholder="docs/example.md"
                disabled={isSaving}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Content
              </span>
              <Textarea
                value={state.content}
                onChange={(event) =>
                  onChange({ ...state, content: event.target.value })
                }
                disabled={isSaving}
                className="min-h-[50vh] font-mono text-xs leading-relaxed"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
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
