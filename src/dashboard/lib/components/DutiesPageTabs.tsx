/**
 * @fileType component
 * @domain kody
 * @pattern duties-page
 * @ai-summary The Duties page: the legacy functional duty list (DutyControl).
 *   "New duty" opens the full folder-duty editor (/executables/new) — so the
 *   list is the familiar functional one, but creating a duty produces the full
 *   model (prompt + tools + skills + scripts + hooks + staff + schedule).
 *   No tabs. Reports have their own route (`/reports`).
 */
"use client";

import { DutyControl } from "./DutyControl";

export function DutiesPageTabs() {
  return <DutyControl />;
}
