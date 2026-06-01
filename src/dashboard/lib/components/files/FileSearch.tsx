/**
 * @fileType component
 * @domain files
 * @pattern file-search
 * @ai-summary Full-text search bar with results grouped by file.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, FileCode2 } from "lucide-react";
import { useFilesContext } from "./FilesContext";
import { searchCode, type SearchResult } from "@dashboard/lib/repo-files";
import { cn } from "@dashboard/lib/utils";
import { toast } from "sonner";

interface FileSearchProps {
  onSelectResult: (path: string) => void;
}

export function FileSearch({ onSelectResult }: FileSearchProps) {
  const { currentBranch } = useFilesContext();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchCode(query, currentBranch);
        setResults(data.results);
        setTotal(data.total);
      } catch (err) {
        console.error("Search failed:", err);
        toast.error("Search failed");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, currentBranch]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      // Navigate to file
      onSelectResult(result.path);
      setOpen(false);
      setQuery("");
    },
    [onSelectResult],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }, []);

  return (
    <div className="relative">
      {/* Search input */}
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-white/40 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search files…"
          className={cn(
            "w-full h-8 pl-8 pr-8 bg-black/30 border border-white/10 rounded text-sm text-white/80",
            "placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-2 p-0.5 rounded hover:bg-white/[0.06] text-white/40 hover:text-white/60 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {open && query.trim() && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-3 text-xs text-white/40 animate-pulse">
                Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-white/40 mb-1">
                  No results for "{query}"
                </p>
                <p className="text-[10px] text-white/25">
                  Try different keywords or check the spelling
                </p>
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 text-[10px] text-white/30 border-b border-white/[0.06]">
                  {total} result{total !== 1 ? "s" : ""} for "{query}"
                </div>
                {results.map((result) => (
                  <button
                    key={result.path}
                    type="button"
                    onClick={() => handleSelect(result)}
                    className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <FileCode2 className="w-3.5 h-3.5 shrink-0 text-white/40" />
                      <span className="text-xs text-white/70 truncate font-mono">
                        {result.path}
                      </span>
                    </div>
                    {result.text_matches
                      .slice(0, 2)
                      .map(
                        (match: SearchResult["text_matches"][0], i: number) => (
                          <div
                            key={i}
                            className="text-[11px] text-white/40 pl-5 truncate"
                          >
                            {match.fragment.slice(0, 120)}
                          </div>
                        ),
                      )}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
