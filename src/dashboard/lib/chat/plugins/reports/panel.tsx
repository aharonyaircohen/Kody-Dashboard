/**
 * @fileType component
 * @domain chat-plugin-reports
 * @pattern plugin-panel-view
 * @ai-summary Reports panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { ReportsView } from "../../../components/ReportsView";
import type { ChatPanelViewProps } from "../../platform";

export const REPORTS_PANEL_TESTID = "chat-panel-reports";

export function ReportsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={REPORTS_PANEL_TESTID}>
      <ReportsView />
    </div>
  );
}
