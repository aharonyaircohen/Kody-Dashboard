/**
 * @fileType component
 * @domain chat-plugin-commands-page
 * @pattern plugin-panel-view
 * @ai-summary Commands panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { CommandsManager } from "../../../components/CommandsManager";
import type { ChatPanelViewProps } from "../../platform";

export const COMMANDS_PAGE_PANEL_TESTID = "chat-panel-commands-page";

export function CommandsPagePanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={COMMANDS_PAGE_PANEL_TESTID}>
      <AuthGuard>
        <CommandsManager />
      </AuthGuard>
    </div>
  );
}
