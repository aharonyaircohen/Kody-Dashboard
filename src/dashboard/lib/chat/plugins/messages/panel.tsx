/**
 * @fileType component
 * @domain chat-plugin-messages
 * @pattern plugin-panel-view
 * @ai-summary Messages panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { MessagesView } from "../../../components/MessagesView";
import type { ChatPanelViewProps } from "../../platform";

export const MESSAGES_PANEL_TESTID = "chat-panel-messages";

export function MessagesPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={MESSAGES_PANEL_TESTID}>
      <div className="h-full p-0 md:p-4">
        <MessagesView />
      </div>
    </div>
  );
}
