/**
 * @fileType component
 * @domain chat-plugin-models
 * @pattern plugin-panel-view
 * @ai-summary Chat Models panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { ModelsManager } from "../../../components/ModelsManager";
import type { ChatPanelViewProps } from "../../platform";

export const MODELS_PANEL_TESTID = "chat-panel-models";

export function ModelsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={MODELS_PANEL_TESTID}>
      <ModelsManager />
    </div>
  );
}
