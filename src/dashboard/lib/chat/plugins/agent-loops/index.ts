/**
 * @fileType module
 * @domain chat-plugin-agent-loops
 * @pattern plugin-manifest
 * @ai-summary Loops page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "agent-loops") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const AGENT_LOOPS_PLUGIN_ID = "agent-loops";
export const AGENT_LOOPS_PANEL_ID = "agent-loops";

export const agentLoopsChatPlugin: ChatPlugin = {
  id: AGENT_LOOPS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: AGENT_LOOPS_PANEL_ID,
      title: "Loops",
      render: createLazyPanel("agent-loops", () =>
        import("./panel").then((m) => ({ default: m.AgentLoopsPanelView })),
      ),
    },
  ],
};
