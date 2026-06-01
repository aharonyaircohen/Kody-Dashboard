/**
 * @fileType context
 * @domain files
 * @pattern files-context
 * @ai-summary React context for sharing file browser state across all file components.
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import type {
  FileEntry,
  FileContent,
  BranchInfo,
} from "@dashboard/lib/repo-files";
import { listDir, readFile, listBranches } from "@dashboard/lib/repo-files";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ViewMode = "view" | "edit" | "preview" | "split";
export type SortField = "name" | "size" | "modified";
export type SortDirection = "asc" | "desc";

export interface FilesContextValue {
  // Branch
  branches: BranchInfo[];
  currentBranch: string;
  setCurrentBranch: (branch: string) => void;
  defaultBranch: string;

  // Path
  currentPath: string;
  setCurrentPath: (path: string) => void;

  // Selected file
  selectedFile: FileEntry | null;
  fileContent: FileContent | null;
  setFileContent: (content: FileContent | null) => void;
  isLoadingContent: boolean;
  selectFile: (entry: FileEntry) => void;
  clearSelectedFile: () => void;

  // Tree data
  treeEntries: FileEntry[];
  treeLoading: boolean;
  treeError: string | null;
  refreshTree: () => void;

  // Sort
  sortField: SortField;
  sortDirection: SortDirection;
  setSortField: (field: SortField) => void;
  setSortDirection: (dir: SortDirection) => void;

  // View mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // UI state
  treeCollapsed: boolean;
  setTreeCollapsed: (v: boolean) => void;

  // Write state
  isSaving: boolean;
  setIsSaving: (v: boolean) => void;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (v: boolean) => void;
  originalContent: string;
  setOriginalContent: (c: string) => void;
}

// ─── Context ───────────────────────────────────────────────────────────────

const FilesContext = createContext<FilesContextValue | null>(null);

export function useFilesContext(): FilesContextValue {
  const ctx = useContext(FilesContext);
  if (!ctx)
    throw new Error("useFilesContext must be used inside FilesProvider");
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────

export function FilesProvider({ children }: { children: React.ReactNode }) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<string>("");
  const [defaultBranch, setDefaultBranch] = useState<string>("main");
  const [currentPath, setCurrentPathState] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [treeEntries, setTreeEntries] = useState<FileEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("view");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [treeCollapsed, setTreeCollapsed] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [originalContent, setOriginalContent] = useState<string>("");

  // Load branches on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await listBranches();
        setBranches(data.branches);
        setDefaultBranch(data.defaultBranch);
        setCurrentBranchState(data.defaultBranch);
      } catch (err) {
        console.error("Failed to load branches:", err);
        // Fallback to main
        setCurrentBranchState("main");
      }
    }
    load();
  }, []);

  // Load directory when path or branch changes
  const refreshTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await listDir(currentPath, currentBranch);
      setTreeEntries(data.entries);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load directory";
      setTreeError(msg);
      setTreeEntries([]);
    } finally {
      setTreeLoading(false);
    }
  }, [currentPath, currentBranch]);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  const selectFile = useCallback(
    async (entry: FileEntry) => {
      if (entry.type === "dir") {
        setSelectedFile(entry);
        setCurrentPathState(entry.path);
        setFileContent(null);
        setViewMode("view");
        setHasUnsavedChanges(false);
        return;
      }
      setSelectedFile(entry);
      setIsLoadingContent(true);
      setViewMode("view");
      setHasUnsavedChanges(false);
      try {
        const content = await readFile(entry.path, currentBranch);
        setFileContent(content);
        setOriginalContent(content.content);
      } catch (err: unknown) {
        console.error("Failed to read file:", err);
        setFileContent(null);
        setOriginalContent("");
      } finally {
        setIsLoadingContent(false);
      }
    },
    [currentBranch],
  );

  const clearSelectedFile = useCallback(() => {
    setSelectedFile(null);
    setFileContent(null);
    setViewMode("view");
    setHasUnsavedChanges(false);
    setOriginalContent("");
  }, []);

  const setCurrentPath = useCallback(
    (path: string) => {
      setCurrentPathState(path);
      clearSelectedFile();
    },
    [clearSelectedFile],
  );

  const setCurrentBranch = useCallback(
    (branch: string) => {
      setCurrentBranchState(branch);
      clearSelectedFile();
    },
    [clearSelectedFile],
  );

  const value: FilesContextValue = {
    branches,
    currentBranch,
    setCurrentBranch,
    defaultBranch,
    currentPath,
    setCurrentPath,
    selectedFile,
    fileContent,
    setFileContent,
    isLoadingContent,
    selectFile,
    clearSelectedFile,
    treeEntries,
    treeLoading,
    treeError,
    refreshTree,
    sortField,
    sortDirection,
    setSortField,
    setSortDirection,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    treeCollapsed,
    setTreeCollapsed,
    isSaving,
    setIsSaving,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    originalContent,
    setOriginalContent,
  };

  return (
    <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
  );
}
