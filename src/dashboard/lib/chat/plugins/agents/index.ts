/**
 * @fileType module
 * @domain chat-plugin-agents
 * @pattern plugin-manifest
 * @ai-summary Agent page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "agents") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { AgentsPanelView, AGENTS_PANEL_TESTID } from "./panel";

export const AGENTS_PLUGIN_ID = "agents";
export const AGENTS_PANEL_ID = "agents";

export const agentsChatPlugin: ChatPlugin = {
  id: AGENTS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: AGENTS_PANEL_ID,
      title: "Agent",
      render: AgentsPanelView,
    },
  ],
};

export { AGENTS_PANEL_TESTID, AgentsPanelView };
