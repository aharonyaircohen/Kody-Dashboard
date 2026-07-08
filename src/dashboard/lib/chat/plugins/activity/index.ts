/**
 * @fileType module
 * @domain chat-plugin-activity
 * @pattern plugin-manifest
 * @ai-summary Activity page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "activity") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const ACTIVITY_PLUGIN_ID = "activity";
export const ACTIVITY_PANEL_ID = "activity";

export const activityChatPlugin: ChatPlugin = {
  id: ACTIVITY_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: ACTIVITY_PANEL_ID,
      title: "Activity",
      render: createLazyPanel(
        "activity",
        () => import("./panel").then((m) => ({ default: m.ActivityPanelView })),
      ),
    },
  ],
};

