/**
 * @fileType module
 * @domain chat-plugin-capabilities
 * @pattern plugin-manifest
 * @ai-summary Capabilities page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "capabilities") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const CAPABILITIES_PLUGIN_ID = "capabilities";
export const CAPABILITIES_PANEL_ID = "capabilities";

export const capabilitiesChatPlugin: ChatPlugin = {
  id: CAPABILITIES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: CAPABILITIES_PANEL_ID,
      title: "Capabilities",
      render: createLazyPanel(
        "capabilities",
        () => import("./panel").then((m) => ({ default: m.CapabilitiesPanelView })),
      ),
    },
  ],
};

