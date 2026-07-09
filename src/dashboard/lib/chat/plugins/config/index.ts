/**
 * @fileType module
 * @domain chat-plugin-config
 * @pattern plugin-manifest
 * @ai-summary Config page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "config") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const CONFIG_PLUGIN_ID = "config";
export const CONFIG_PANEL_ID = "config";

export const configChatPlugin: ChatPlugin = {
  id: CONFIG_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: CONFIG_PANEL_ID,
      title: "Config",
      render: createLazyPanel("config", () =>
        import("./panel").then((m) => ({ default: m.ConfigPanelView })),
      ),
    },
  ],
};
