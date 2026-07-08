/**
 * @fileType component
 * @domain chat-plugin-preview
 * @pattern plugin-panel-view
 * @ai-summary Views panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { PreviewWorkspace } from "../../../components/PreviewWorkspace";
import type { ChatPanelViewProps } from "../../platform";

export const PREVIEW_PANEL_TESTID = "chat-panel-preview";

export function PreviewPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={PREVIEW_PANEL_TESTID}>
      <PreviewWorkspace />
    </div>
  );
}
