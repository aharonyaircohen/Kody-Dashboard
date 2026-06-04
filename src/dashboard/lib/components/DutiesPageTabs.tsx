/**
 * @fileType component
 * @domain kody
 * @pattern duties-page
 * @ai-summary The Duties page: a single flat list of every duty — no tabs.
 *   There is one duty concept now (a folder at `.kody/duties/<slug>/` with a
 *   profile + staff); scheduled and on-demand duties live in the same list.
 *   Reports have their own route (`/reports`). ExecutablesManager owns its
 *   page chrome (PageShell: back arrow, title, actions), so this is a thin
 *   pass-through kept for the stable `/duties` import.
 */
"use client";

import { ExecutablesManager } from "./ExecutablesManager";

export function DutiesPageTabs() {
  return <ExecutablesManager />;
}
