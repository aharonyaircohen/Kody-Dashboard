/**
 * @fileType component
 * @domain layout
 * @pattern master-detail
 * @ai-summary The shared master/detail page used by Jobs, AgentResponsibilities, and
 *   AgentActions — a searchable list aside on the left and a detail pane on the
 *   right, under one PageHeader. Extracted from AgentResponsibilityControl (the reference UX)
 *   so the three object pages share ONE layout instead of three from-scratch
 *   copies. On mobile the list and detail swap full-screen based on selection.
 */
"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils";
import { PageHeader } from "./PageShell";
import { ListSearch } from "./ListSearch";

type Accent = "sky" | "emerald" | "teal" | "violet" | "amber";

export function MasterDetailShell({
  title,
  icon,
  iconClassName,
  subtitle,
  actions,
  error,
  search,
  onSearch,
  searchPlaceholder,
  searchAriaLabel,
  accent = "emerald",
  listAside,
  children,
  listWidth = "md:w-80",
  hasSelection,
  detail,
}: {
  title: string;
  icon: LucideIcon;
  iconClassName?: string;
  subtitle?: string;
  actions?: ReactNode;
  error?: string | null;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  accent?: Accent;
  /** Extra content above the list rows (e.g. a health summary bar). */
  listAside?: ReactNode;
  /** The list rows / loading / empty state. */
  children: ReactNode;
  /** Tailwind width for the list aside on desktop. */
  listWidth?: string;
  /** Whether a detail item is selected (drives the mobile swap). */
  hasSelection: boolean;
  /** The detail pane (selected item or its empty state). */
  detail: ReactNode;
}) {
  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      <PageHeader
        title={title}
        icon={icon}
        iconClassName={iconClassName}
        subtitle={subtitle}
        actions={actions}
      />

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        {/* List — full width on mobile, fixed sidebar on desktop. */}
        <aside
          className={cn(
            "w-full md:border-r md:border-border flex flex-col min-h-0",
            listWidth,
            hasSelection && "hidden md:flex",
          )}
        >
          <div className="shrink-0 px-3 md:px-4 py-2 md:py-3 border-b border-border">
            <ListSearch
              value={search}
              onChange={onSearch}
              placeholder={searchPlaceholder}
              ariaLabel={searchAriaLabel}
              accent={accent}
            />
            {listAside}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        </aside>

        {/* Detail */}
        <section
          className={cn(
            "flex-1 min-w-0 overflow-y-auto",
            !hasSelection && "hidden md:block",
          )}
        >
          {detail}
        </section>
      </div>
    </div>
  );
}
