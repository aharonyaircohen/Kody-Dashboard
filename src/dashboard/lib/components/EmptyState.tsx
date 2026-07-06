/**
 * @fileType component
 * @domain layout
 * @pattern empty-state
 * @ai-summary Shared empty/placeholder state for list panes and detail panes.
 *   One source of truth so Jobs, Capabilities, and Implementations render identical
 *   "nothing here / select one / loading" blocks instead of three local copies.
 */
"use client";

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  /** Optional CTA rendered under the hint (e.g. a "New" button). */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60 [&>svg]:w-10 [&>svg]:h-10">
        {icon}
      </div>
      <div className="text-body-sm font-medium text-white/70">{title}</div>
      {hint ? <p className="text-body-xs mt-1.5 max-w-xs">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
