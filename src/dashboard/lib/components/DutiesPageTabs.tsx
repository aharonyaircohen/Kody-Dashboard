/**
 * @fileType component
 * @domain kody
 * @pattern duties-page
 * @ai-summary The Duties page: the legacy functional duty list (DutyControl).
 *   Duties own public actions, agent, schedule, and optional implementation
 *   executable links. No tabs. Reports have their own route (`/reports`).
 */
"use client";

import { DutyControl } from "./DutyControl";

export function DutiesPageTabs() {
  return <DutyControl />;
}
