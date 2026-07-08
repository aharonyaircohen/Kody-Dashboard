/**
 * @fileType module
 * @domain chat-plugin-inbox
 * @pattern plugin-manifest
 * @ai-summary Inbox page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "inbox") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { InboxPanelView, INBOX_PANEL_TESTID } from "./panel";

export const INBOX_PLUGIN_ID = "inbox";
export const INBOX_PANEL_ID = "inbox";

export const inboxChatPlugin: ChatPlugin = {
  id: INBOX_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: INBOX_PANEL_ID,
      title: "Inbox",
      render: InboxPanelView,
    },
  ],
};

export { INBOX_PANEL_TESTID, InboxPanelView };
