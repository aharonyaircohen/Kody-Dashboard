/**
 * @fileType component
 * @domain chat-plugin-changelog
 * @pattern plugin-panel-view
 * @ai-summary Changelog panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { ChangelogView } from "../../../components/ChangelogView";
import type { ChatPanelViewProps } from "../../platform";

export const CHANGELOG_PANEL_TESTID = "chat-panel-changelog";

export function ChangelogPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={CHANGELOG_PANEL_TESTID}>
      <AuthGuard>
        <ChangelogView />
      </AuthGuard>
    </div>
  );
}
