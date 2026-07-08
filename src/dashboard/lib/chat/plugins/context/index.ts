/**
 * @fileType module
 * @domain chat-plugin-context
 * @pattern plugin-manifest
 * @ai-summary Context page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "context") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { ContextPanelView, CONTEXT_PANEL_TESTID } from "./panel";

export const CONTEXT_PLUGIN_ID = "context";
export const CONTEXT_PANEL_ID = "context";

export const contextChatPlugin: ChatPlugin = {
  id: CONTEXT_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: CONTEXT_PANEL_ID,
      title: "Context",
      render: ContextPanelView,
    },
  ],
};

export { CONTEXT_PANEL_TESTID, ContextPanelView };
