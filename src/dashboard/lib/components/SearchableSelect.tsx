"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { cn } from "../utils";

export interface SearchableSelectOption {
  value: string | null;
  label: string;
  selectedLabel?: string;
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
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
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

  const updatePlacement = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportGap = 16;
    const expectedMenuHeight = 288;
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
    const spaceAbove = rect.top - viewportGap;
    setPlacement(
      spaceBelow < expectedMenuHeight && spaceAbove > spaceBelow
        ? "top"
        : "bottom",
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePlacement();
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
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, updatePlacement]);

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
          if (!open) updatePlacement();
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
        <div
          className={cn(
            "absolute left-0 right-0 z-[80] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-elevation-3",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
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
  showSelectedSummary = true,
  closeOnSelect = false,
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
  showSelectedSummary?: boolean;
  closeOnSelect?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const [menuMaxHeight, setMenuMaxHeight] = useState(320);
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

  const updatePlacement = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportGap = 16;
    const minUsableMenuHeight = 180;
    const maxMenuHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
    const spaceAbove = rect.top - viewportGap;
    const nextPlacement =
      spaceBelow < minUsableMenuHeight && spaceAbove > spaceBelow
        ? "top"
        : "bottom";
    const availableSpace = nextPlacement === "top" ? spaceAbove : spaceBelow;
    setPlacement(nextPlacement);
    setMenuMaxHeight(
      Math.max(minUsableMenuHeight, Math.min(maxMenuHeight, availableSpace)),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePlacement();
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
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, updatePlacement]);

  const toggle = (optionValue: string) => {
    onChange(
      selected.has(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue].sort(),
    );
    if (closeOnSelect) {
      setOpen(false);
      setQuery("");
    }
  };
  const remove = (optionValue: string) => {
    onChange(value.filter((item) => item !== optionValue));
  };

  return (
    <div
      ref={rootRef}
      className="relative w-full min-w-0 max-w-full"
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
          if (!open) updatePlacement();
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

      {showSelectedSummary && selectedOptions.length ? (
        <div
          className={cn(
            "mt-2 min-w-0 max-w-full overflow-x-hidden rounded-lg border px-3 py-2 text-xs text-muted-foreground",
            selectedTone === "info"
              ? "border-sky-500/20 bg-sky-500/[0.06]"
              : "border-border/70 bg-muted/25",
          )}
          aria-label={selectedHeading}
        >
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {visibleSelected.map((option) => (
              <span
                key={option.value}
                className="inline-flex min-w-0 max-w-[11rem] items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-1 text-foreground sm:max-w-[14rem]"
                title={option.label}
              >
                <span className="truncate">
                  {option.selectedLabel ?? option.label}
                </span>
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
          className={cn(
            "absolute left-0 right-0 z-[80] min-w-0 max-w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-elevation-3",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
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
          <div
            className="overflow-y-auto overflow-x-hidden p-1"
            style={{ maxHeight: menuMaxHeight }}
            role="listbox"
          >
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
                      "flex w-full min-w-0 max-w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                      active && "bg-accent/70",
                    )}
                    onClick={() => toggle(option.value)}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {active ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden">
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
