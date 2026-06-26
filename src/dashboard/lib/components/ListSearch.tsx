/**
 * @fileType component
 * @domain kody
 * @pattern list-search
 * @ai-summary Shared search input for list pages (capabilities, agent, prompts).
 *   Mirrors the inline filter on the Reports view: a plain `type="search"`
 *   box that filters the list client-side, no debounce. `accent` tints the
 *   focus ring to match each page's icon color. Render it inside whatever
 *   wrapper the page needs (sticky header, card stack, …); this component
 *   owns only the input.
 */
import { cn } from "../utils";

const ACCENT_RING = {
  sky: "focus:ring-sky-500/40",
  emerald: "focus:ring-emerald-500/40",
  violet: "focus:ring-violet-500/40",
  teal: "focus:ring-teal-500/40",
  amber: "focus:ring-amber-500/40",
} as const;

export function ListSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  accent = "sky",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  accent?: keyof typeof ACCENT_RING;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        "w-full bg-background/40 border border-border rounded-md",
        "px-3 py-2 text-sm placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-2",
        ACCENT_RING[accent],
      )}
    />
  );
}
