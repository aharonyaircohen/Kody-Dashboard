/**
 * @fileType component
 * @domain chat-plugin-workflows
 * @pattern plugin-panel-view
 * @ai-summary Workflows panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { WorkflowsManager } from "../../../components/WorkflowsManager";
import type { ChatPanelViewProps } from "../../platform";

export const WORKFLOWS_PANEL_TESTID = "chat-panel-workflows";

export function WorkflowsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={WORKFLOWS_PANEL_TESTID}>
      <WorkflowsManager />
    </div>
  );
}
