/**
 * @fileType module
 * @domain chat-plugin-preview
 * @pattern plugin-manifest
 * @ai-summary Views page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "preview") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const PREVIEW_PLUGIN_ID = "preview";
export const PREVIEW_PANEL_ID = "preview";

export const previewChatPlugin: ChatPlugin = {
  id: PREVIEW_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: PREVIEW_PANEL_ID,
      title: "Views",
      render: createLazyPanel(
        "preview",
        () => import("./panel").then((m) => ({ default: m.PreviewPanelView })),
      ),
    },
  ],
};

