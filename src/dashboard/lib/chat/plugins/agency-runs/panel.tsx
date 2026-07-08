/**
 * @fileType component
 * @domain chat-plugin-agency-runs
 * @pattern plugin-panel-view
 * @ai-summary Agency Runs panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AgencyRunsPage } from "../../../components/AgencyRunsPage";
import type { ChatPanelViewProps } from "../../platform";

export const AGENCY_RUNS_PANEL_TESTID = "chat-panel-agency-runs";

export function AgencyRunsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={AGENCY_RUNS_PANEL_TESTID}>
      <AgencyRunsPage />
    </div>
  );
}
