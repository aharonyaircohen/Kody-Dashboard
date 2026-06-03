/**
 * @fileType component
 * @domain kody
 * @pattern duties-page
 * @ai-summary The Duties page: the legacy functional duty manager (DutyControl)
 *   — one list with schedule, enable/disable, run, edit, health. No tabs.
 *   Reports have their own route (`/reports`). Kept as a thin pass-through for
 *   the stable `/duties` import.
 */
"use client";

import { DutyControl } from "./DutyControl";

export function DutiesPageTabs() {
  return <DutyControl />;
}
