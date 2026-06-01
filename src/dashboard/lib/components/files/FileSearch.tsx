/**
 * @fileType component
 * @domain kody
 * @pattern file-search
 * @ai-summary Component for searching files in the repository
 */
"use client";

import { useState, useCallback } from "react";
import { Search, Loader2, File, Folder, X, Clock } from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type SearchResult } from "./FilesContext";

interface FileSearchProps {
  onResultSelect: (result: SearchResult) => void;
  className?: string;
}

function formatScore(score: number): string {
  return (score * 100).toFixed(0) + "%";
}

export function FileSearch({ onResultSelect, className }: FileSearchProps) {
  const {
    currentBranch,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    isSearching,
    setIsSearching,
    setError,
  } = useFiles();

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      setError(null);
      setSearchQuery(query);

      try {
        const params = new URLSearchParams({ q: query });
        if (currentBranch) params.set("ref", currentBranch);

        const res = await fetch(`/api/kody/files/search?${params}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Search failed");
        }

        const data = await res.json();
        setSearchResults(data.results || []);

        // Add to recent searches
        setRecentSearches((prev) => {
          const filtered = prev.filter((s) => s !== query);
          return [query, ...filtered].slice(0, 5);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [currentBranch, setSearchQuery, setSearchResults, setIsSearching, setError],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(localQuery);
  };

  const handleClear = () => {
    setLocalQuery("");
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleRecentClick = (query: string) => {
    setLocalQuery(query);
    handleSearch(query);
  };

  const handleResultClick = (result: SearchResult) => {
    onResultSelect(result);
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Search input */}
      <form onSubmit={handleSubmit} className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search files..."
            className={cn(
              "w-full pl-9 pr-8 py-2 text-sm",
              "bg-background border rounded-md",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
          {localQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {isSearching ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Searching...
            </span>
          </div>
        ) : searchResults.length > 0 ? (
          <div className="py-1">
            <div className="px-3 py-1 text-xs text-muted-foreground uppercase tracking-wider">
              {searchResults.length} results
            </div>
            {searchResults.map((result, index) => (
              <div
                key={`${result.path}-${index}`}
                onClick={() => handleResultClick(result)}
                className={cn(
                  "flex items-start gap-2 px-3 py-2 cursor-pointer",
                  "hover:bg-accent transition-colors",
                )}
              >
                <File className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {result.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatScore(result.score)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {result.path}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : searchQuery && !isSearching ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Search className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm">No files found</p>
          </div>
        ) : recentSearches.length > 0 ? (
          <div className="py-1">
            <div className="px-3 py-1 text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Recent
            </div>
            {recentSearches.map((query, index) => (
              <div
                key={index}
                onClick={() => handleRecentClick(query)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer",
                  "hover:bg-accent transition-colors",
                )}
              >
                <Clock className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">{query}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Search className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm">Search for files by name</p>
          </div>
        )}
      </div>
    </div>
  );
}
