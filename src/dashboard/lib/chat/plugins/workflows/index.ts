/**
 * @fileType module
 * @domain chat-plugin-workflows
 * @pattern plugin-manifest
 * @ai-summary Workflows page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "workflows") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const WORKFLOWS_PLUGIN_ID = "workflows";
export const WORKFLOWS_PANEL_ID = "workflows";

export const workflowsChatPlugin: ChatPlugin = {
  id: WORKFLOWS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: WORKFLOWS_PANEL_ID,
      title: "Workflows",
      render: createLazyPanel(
        "workflows",
        () => import("./panel").then((m) => ({ default: m.WorkflowsPanelView })),
      ),
    },
  ],
};

