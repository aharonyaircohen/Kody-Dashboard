/**
 * @fileType module
 * @domain chat-plugin-variables
 * @pattern plugin-manifest
 * @ai-summary Variables page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "variables") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const VARIABLES_PLUGIN_ID = "variables";
export const VARIABLES_PANEL_ID = "variables";

export const variablesChatPlugin: ChatPlugin = {
  id: VARIABLES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: VARIABLES_PANEL_ID,
      title: "Variables",
      render: createLazyPanel("variables", () =>
        import("./panel").then((m) => ({ default: m.VariablesPanelView })),
      ),
    },
  ],
};
