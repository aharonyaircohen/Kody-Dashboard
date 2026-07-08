/**
 * @fileType component
 * @domain chat-plugin-agents
 * @pattern plugin-panel-view
 * @ai-summary Agent panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { AgentsPageTabs } from "../../../components/AgentsPageTabs";
import type { ChatPanelViewProps } from "../../platform";

export const AGENTS_PANEL_TESTID = "chat-panel-agents";

export function AgentsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={AGENTS_PANEL_TESTID}>
      <AuthGuard>
        <AgentsPageTabs />
      </AuthGuard>
    </div>
  );
}
