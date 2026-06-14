/**
 * @fileType component
 * @domain files
 * @pattern file-search
 * @ai-summary Full-text code search for the /files page. Debounces
 *   300ms, shows results grouped by file with matched snippets, and
 *   supports click-to-navigate to the match.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Loader2, FileCode2, X } from "lucide-react";
import { cn } from "@dashboard/lib/utils";
import { searchCode, type SearchResult } from "@dashboard/lib/repo-files";
import type { Octokit } from "@octokit/rest";

interface FileSearchProps {
  octokit: Octokit | null;
  owner: string;
  repo: string;
  onResultClick: (path: string, line?: number) => void;
  onClose?: () => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function FileSearch({
  octokit,
  owner,
  repo,
  onResultClick,
  onClose,
}: FileSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search when debounced query changes
  useEffect(() => {
    if (!octokit || debouncedQuery.trim().length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }

    const doSearch = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchCode(octokit, owner, repo, debouncedQuery);
        setResults(data.results);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    };

    doSearch();
  }, [octokit, owner, repo, debouncedQuery]);

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setTotal(0);
    onClose?.();
  };

  // Group results by file path
  const groupedResults = results.reduce<Record<string, SearchResult[]>>(
    (acc, result) => {
      const key = result.path;
      if (!acc[key]) acc[key] = [];
      acc[key].push(result);
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
        <Search className="w-4 h-4 text-white/40 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code..."
          className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/30 outline-none"
        />
        {loading && (
          <Loader2 className="w-4 h-4 animate-spin text-white/40 shrink-0" />
        )}
        {query && !loading && (
          <button
            onClick={handleClear}
            className="p-1 rounded hover:bg-white/10 text-white/40"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="flex items-center justify-center py-8 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!error && query.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center py-8 text-white/40 text-sm">
            <Search className="w-6 h-6 mb-2" />
            <span>Type at least 2 characters to search</span>
          </div>
        )}

        {!error &&
          query.trim().length >= 2 &&
          !loading &&
          results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-white/40 text-sm">
              <span>No results for "{query}"</span>
            </div>
          )}

        {!error && results.length > 0 && (
          <div className="py-1">
            <div className="px-4 py-1 text-xs text-white/30">
              {total} result{total !== 1 ? "s" : ""}
            </div>

            {Object.entries(groupedResults).map(([filePath, fileResults]) => (
              <div key={filePath} className="border-b border-white/5">
                <div className="flex items-center gap-2 px-4 py-1.5 bg-white/5">
                  <FileCode2 className="w-3.5 h-3.5 text-white/40 shrink-0" />
                  <button
                    className="text-xs text-white/70 hover:text-white/90 truncate"
                    onClick={() => onResultClick(filePath)}
                  >
                    {filePath}
                  </button>
                </div>

                {fileResults.map((result, i) => (
                  <button
                    key={i}
                    className={cn(
                      "w-full text-left px-4 py-1.5 pl-10 text-xs",
                      "hover:bg-white/5",
                      "font-mono whitespace-pre-wrap break-all",
                    )}
                    onClick={() =>
                      onResultClick(
                        filePath,
                        result.lineInFragment ?? undefined,
                      )
                    }
                  >
                    {result.lineInFragment && (
                      <span className="text-white/30 mr-2">
                        {result.lineInFragment}:
                      </span>
                    )}
                    <span className="text-white/60">{result.snippet}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
