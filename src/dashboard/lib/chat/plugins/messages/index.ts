/**
 * @fileType module
 * @domain chat-plugin-messages
 * @pattern plugin-manifest
 * @ai-summary Messages page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "messages") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const MESSAGES_PLUGIN_ID = "messages";
export const MESSAGES_PANEL_ID = "messages";

export const messagesChatPlugin: ChatPlugin = {
  id: MESSAGES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: MESSAGES_PANEL_ID,
      title: "Messages",
      render: createLazyPanel("messages", () =>
        import("./panel").then((m) => ({ default: m.MessagesPanelView })),
      ),
    },
  ],
};
