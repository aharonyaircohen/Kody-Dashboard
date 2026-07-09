/**
 * @fileType module
 * @domain chat-plugin-commands-page
 * @pattern plugin-manifest
 * @ai-summary Commands page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "commands-page") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const COMMANDS_PAGE_PLUGIN_ID = "commands-page";
export const COMMANDS_PAGE_PANEL_ID = "commands-page";

export const commandsPageChatPlugin: ChatPlugin = {
  id: COMMANDS_PAGE_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: COMMANDS_PAGE_PANEL_ID,
      title: "Commands",
      render: createLazyPanel("commands-page", () =>
        import("./panel").then((m) => ({ default: m.CommandsPagePanelView })),
      ),
    },
  ],
};
