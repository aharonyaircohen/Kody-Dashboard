/**
 * @fileType context
 * @domain kody
 * @pattern files-context
 * @ai-summary React context for the files browser state management
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface FileItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  sha: string;
  download_url?: string;
}

export interface BranchInfo {
  name: string;
  protected: boolean;
  isDefault: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: {
    name?: string;
    email?: string;
    date?: string;
  };
  committer: {
    name?: string;
    email?: string;
    date?: string;
  };
  html_url: string;
}

export interface FileDiff {
  filename: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  raw_url: string;
  contents_url: string;
  blob_url: string;
  previous_filename?: string;
}

export interface SearchResult {
  name: string;
  path: string;
  sha: string;
  url: string;
  git_url: string;
  html_url: string;
  repository: {
    full_name: string;
    description?: string;
  };
  score: number;
}

interface FilesState {
  currentPath: string;
  currentBranch: string;
  selectedFile: FileItem | null;
  expandedDirs: Set<string>;
  isLoading: boolean;
  error: string | null;
  branches: BranchInfo[];
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  viewMode: "tree" | "list";
  diffBase: string;
  diffHead: string;
  showDiff: boolean;
}

interface FilesContextValue extends FilesState {
  setCurrentPath: (path: string) => void;
  setCurrentBranch: (branch: string) => void;
  setSelectedFile: (file: FileItem | null) => void;
  toggleDir: (path: string) => void;
  setExpandedDirs: (dirs: Set<string>) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBranches: (branches: BranchInfo[]) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (searching: boolean) => void;
  setViewMode: (mode: "tree" | "list") => void;
  setDiffBase: (base: string) => void;
  setDiffHead: (head: string) => void;
  setShowDiff: (show: boolean) => void;
  reset: () => void;
}

const FilesContext = createContext<FilesContextValue | null>(null);

const INITIAL_STATE: FilesState = {
  currentPath: "",
  currentBranch: "",
  selectedFile: null,
  expandedDirs: new Set(),
  isLoading: false,
  error: null,
  branches: [],
  searchQuery: "",
  searchResults: [],
  isSearching: false,
  viewMode: "tree",
  diffBase: "",
  diffHead: "",
  showDiff: false,
};

export function FilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FilesState>(INITIAL_STATE);

  const setCurrentPath = useCallback((path: string) => {
    setState((prev) => ({ ...prev, currentPath: path }));
  }, []);

  const setCurrentBranch = useCallback((branch: string) => {
    setState((prev) => ({ ...prev, currentBranch: branch }));
  }, []);

  const setSelectedFile = useCallback((file: FileItem | null) => {
    setState((prev) => ({ ...prev, selectedFile: file }));
  }, []);

  const toggleDir = useCallback((path: string) => {
    setState((prev) => {
      const newDirs = new Set(prev.expandedDirs);
      if (newDirs.has(path)) {
        newDirs.delete(path);
      } else {
        newDirs.add(path);
      }
      return { ...prev, expandedDirs: newDirs };
    });
  }, []);

  const setExpandedDirs = useCallback((dirs: Set<string>) => {
    setState((prev) => ({ ...prev, expandedDirs: dirs }));
  }, []);

  const setIsLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setBranches = useCallback((branches: BranchInfo[]) => {
    setState((prev) => ({ ...prev, branches }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setSearchResults = useCallback((results: SearchResult[]) => {
    setState((prev) => ({ ...prev, searchResults: results }));
  }, []);

  const setIsSearching = useCallback<(searching: boolean) => void>(
    (searching) => {
      setState((prev) => ({ ...prev, isSearching: searching }));
    },
    [],
  );

  const setViewMode = useCallback((mode: "tree" | "list") => {
    setState((prev) => ({ ...prev, viewMode: mode }));
  }, []);

  const setDiffBase = useCallback((base: string) => {
    setState((prev) => ({ ...prev, diffBase: base }));
  }, []);

  const setDiffHead = useCallback<(head: string) => void>((head) => {
    setState((prev) => ({ ...prev, diffHead: head }));
  }, []);

  const setShowDiff = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showDiff: show }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const value: FilesContextValue = {
    ...state,
    setCurrentPath,
    setCurrentBranch,
    setSelectedFile,
    toggleDir,
    setExpandedDirs,
    setIsLoading,
    setError,
    setBranches,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
    setViewMode,
    setDiffBase,
    setDiffHead,
    setShowDiff,
    reset,
  };

  return (
    <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
  );
}

export function useFiles(): FilesContextValue {
  const context = useContext(FilesContext);
  if (!context) {
    throw new Error("useFiles must be used within a FilesProvider");
  }
  return context;
}
