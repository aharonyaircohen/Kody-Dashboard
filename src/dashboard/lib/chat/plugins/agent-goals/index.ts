/**
 * @fileType module
 * @domain chat-plugin-agent-goals
 * @pattern plugin-manifest
 * @ai-summary Goals page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "agent-goals") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const AGENT_GOALS_PLUGIN_ID = "agent-goals";
export const AGENT_GOALS_PANEL_ID = "agent-goals";

export const agentGoalsChatPlugin: ChatPlugin = {
  id: AGENT_GOALS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: AGENT_GOALS_PANEL_ID,
      title: "Goals",
      render: createLazyPanel(
        "agent-goals",
        () => import("./panel").then((m) => ({ default: m.AgentGoalsPanelView })),
      ),
    },
  ],
};

