/**
 * @fileType component
 * @domain chat-plugin-activity
 * @pattern plugin-panel-view
 * @ai-summary Activity panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { ActivityPage } from "../../../components/ActivityPage";
import type { ChatPanelViewProps } from "../../platform";

export const ACTIVITY_PANEL_TESTID = "chat-panel-activity";

export function ActivityPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={ACTIVITY_PANEL_TESTID}>
      <AuthGuard>
        <ActivityPage />
      </AuthGuard>
    </div>
  );
}
