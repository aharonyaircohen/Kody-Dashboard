/**
 * @fileType module
 * @domain chat-plugin-models
 * @pattern plugin-manifest
 * @ai-summary Chat Models page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "models") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const MODELS_PLUGIN_ID = "models";
export const MODELS_PANEL_ID = "models";

export const modelsChatPlugin: ChatPlugin = {
  id: MODELS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: MODELS_PANEL_ID,
      title: "Chat Models",
      render: createLazyPanel("models", () =>
        import("./panel").then((m) => ({ default: m.ModelsPanelView })),
      ),
    },
  ],
};
