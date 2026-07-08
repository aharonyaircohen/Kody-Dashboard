/**
 * @fileType component
 * @domain chat-plugin-agent-goals
 * @pattern plugin-panel-view
 * @ai-summary Goals panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { ManagedModelsView } from "../../../components/ManagedModelsView";
import type { ChatPanelViewProps } from "../../platform";

export const AGENT_GOALS_PANEL_TESTID = "chat-panel-agent-goals";

export function AgentGoalsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={AGENT_GOALS_PANEL_TESTID}>
      <ManagedModelsView model="agentGoal" />
    </div>
  );
}
