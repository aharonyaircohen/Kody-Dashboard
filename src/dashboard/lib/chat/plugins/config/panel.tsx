/**
 * @fileType component
 * @domain chat-plugin-config
 * @pattern plugin-panel-view
 * @ai-summary Config panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { RepoConfigManager } from "../../../components/RepoConfigManager";
import type { ChatPanelViewProps } from "../../platform";

export const CONFIG_PANEL_TESTID = "chat-panel-config";

export function ConfigPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={CONFIG_PANEL_TESTID}>
      <AuthGuard>
        <RepoConfigManager />
      </AuthGuard>
    </div>
  );
}
