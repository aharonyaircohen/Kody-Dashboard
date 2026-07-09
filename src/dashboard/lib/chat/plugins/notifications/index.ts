/**
 * @fileType module
 * @domain chat-plugin-notifications
 * @pattern plugin-manifest
 * @ai-summary Notifications page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "notifications") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const NOTIFICATIONS_PLUGIN_ID = "notifications";
export const NOTIFICATIONS_PANEL_ID = "notifications";

export const notificationsChatPlugin: ChatPlugin = {
  id: NOTIFICATIONS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: NOTIFICATIONS_PANEL_ID,
      title: "Notifications",
      render: createLazyPanel("notifications", () =>
        import("./panel").then((m) => ({ default: m.NotificationsPanelView })),
      ),
    },
  ],
};
