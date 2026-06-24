/**
 * @fileType component
 * @domain kody
 * @pattern agentResponsibilities-page
 * @ai-summary The AgentResponsibilities page: the legacy functional agentResponsibility list (AgentResponsibilityControl).
 *   AgentResponsibilities own public actions, agent, schedule, and optional implementation
 *   agentAction links. No tabs. Reports have their own route (`/reports`).
 */
"use client";

import { AgentResponsibilityControl } from "./AgentResponsibilityControl";

export function AgentResponsibilitiesPageTabs() {
  return <AgentResponsibilityControl />;
}
