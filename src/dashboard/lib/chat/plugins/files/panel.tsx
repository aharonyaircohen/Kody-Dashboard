/**
 * @fileType component
 * @domain chat-plugin-files
 * @pattern plugin-panel-view
 * @ai-summary Files panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { FilesPage } from "../../../../components/files/FilesPage";
import type { ChatPanelViewProps } from "../../platform";

export const FILES_PANEL_TESTID = "chat-panel-files";

export function FilesPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={FILES_PANEL_TESTID}>
      <FilesPage />
    </div>
  );
}
