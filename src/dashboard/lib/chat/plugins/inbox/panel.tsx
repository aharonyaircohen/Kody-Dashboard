/**
 * @fileType component
 * @domain chat-plugin-inbox
 * @pattern plugin-panel-view
 * @ai-summary Inbox panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { InboxList } from "../../../components/InboxList";
import type { ChatPanelViewProps } from "../../platform";

export const INBOX_PANEL_TESTID = "chat-panel-inbox";

export function InboxPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={INBOX_PANEL_TESTID}>
      <InboxList />
    </div>
  );
}
