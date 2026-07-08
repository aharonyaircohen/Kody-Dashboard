/**
 * @fileType component
 * @domain chat-plugin-variables
 * @pattern plugin-panel-view
 * @ai-summary Variables panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { VariablesManager } from "../../../components/VariablesManager";
import type { ChatPanelViewProps } from "../../platform";

export const VARIABLES_PANEL_TESTID = "chat-panel-variables";

export function VariablesPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={VARIABLES_PANEL_TESTID}>
      <VariablesManager />
    </div>
  );
}
