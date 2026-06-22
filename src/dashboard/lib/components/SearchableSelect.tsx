"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { cn } from "../utils";

export interface SearchableSelectOption {
  value: string | null;
  label: string;
  searchText?: string;
  description?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  options: SearchableSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      (option.searchText ?? `${option.label} ${option.description ?? ""}`)
        .toLowerCase()
        .includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      data-searchable-select-open={open ? "true" : undefined}
    >
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-10 w-full justify-between bg-elevated px-3 text-left font-normal"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setOpen((next) => !next);
          setQuery("");
        }}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-[80] mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-elevation-3">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="h-8 pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                {emptyLabel}
              </div>
            ) : (
              filtered.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value ?? "__none__"}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    className={cn(
                      "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                      active && "bg-accent/70",
                    )}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {active ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SearchableMultiSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search...",
  emptyLabel = "No matches",
  disabled,
  selectedLabel = "selected",
  selectedSingularLabel,
  selectedHeading = "Selected",
  selectedTone = "default",
  maxVisibleSelected = 6,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: SearchableSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  selectedLabel?: string;
  selectedSingularLabel?: string;
  selectedHeading?: string;
  selectedTone?: "default" | "info";
  maxVisibleSelected?: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const selectableOptions = useMemo(
    () =>
      options.filter(
        (option): option is SearchableSelectOption & { value: string } =>
          typeof option.value === "string",
      ),
    [options],
  );
  const selectedOptions = useMemo(
    () => selectableOptions.filter((option) => selected.has(option.value)),
    [selectableOptions, selected],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selectableOptions;
    return selectableOptions.filter((option) =>
      (option.searchText ?? `${option.label} ${option.description ?? ""}`)
        .toLowerCase()
        .includes(q),
    );
  }, [selectableOptions, query]);
  const visibleSelected = selectedOptions.slice(0, maxVisibleSelected);
  const hiddenSelectedCount = Math.max(
    0,
    selectedOptions.length - visibleSelected.length,
  );
  const selectedSummary =
    value.length === 1 && selectedSingularLabel
      ? `1 ${selectedSingularLabel}`
      : `${value.length} ${selectedLabel}`;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const toggle = (optionValue: string) => {
    onChange(
      selected.has(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue].sort(),
    );
  };
  const remove = (optionValue: string) => {
    onChange(value.filter((item) => item !== optionValue));
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      data-searchable-select-open={open ? "true" : undefined}
    >
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-10 w-full justify-between gap-3 overflow-hidden bg-elevated px-3 text-left font-normal"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setOpen((next) => !next);
          setQuery("");
        }}
      >
        <span
          className={cn(
            "truncate",
            value.length === 0 && "text-muted-foreground",
          )}
        >
          {value.length ? selectedSummary : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {selectedOptions.length ? (
        <div
          className={cn(
            "mt-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground",
            selectedTone === "info"
              ? "border-sky-500/20 bg-sky-500/[0.06]"
              : "border-border/70 bg-muted/25",
          )}
          aria-label={selectedHeading}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {selectedHeading}
            </p>
            {selectedOptions.length > 1 ? (
              <button
                type="button"
                className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onClick={() => onChange([])}
              >
                Clear all
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleSelected.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-1 text-foreground"
              >
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  className="rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label={`Remove ${option.label}`}
                  onClick={() => remove(option.value)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {hiddenSelectedCount ? (
              <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground">
                +{hiddenSelectedCount} more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {open ? (
        <div
          className="z-[80] mt-1 w-full min-w-0 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-elevation-3"
          data-searchable-multi-select-menu
        >
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="h-8 pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                {emptyLabel}
              </div>
            ) : (
              filtered.map((option) => {
                const active = selected.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    className={cn(
                      "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                      active && "bg-accent/70",
                    )}
                    onClick={() => toggle(option.value)}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {active ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
