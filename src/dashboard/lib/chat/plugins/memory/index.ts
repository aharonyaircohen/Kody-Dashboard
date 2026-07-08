/**
 * @fileType module
 * @domain chat-plugin-memory
 * @pattern plugin-manifest
 * @ai-summary Memory page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "memory") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { MemoryPanelView, MEMORY_PANEL_TESTID } from "./panel";

export const MEMORY_PLUGIN_ID = "memory";
export const MEMORY_PANEL_ID = "memory";

export const memoryChatPlugin: ChatPlugin = {
  id: MEMORY_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: MEMORY_PANEL_ID,
      title: "Memory",
      render: MemoryPanelView,
    },
  ],
};

export { MEMORY_PANEL_TESTID, MemoryPanelView };
