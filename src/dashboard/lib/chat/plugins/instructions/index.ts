/**
 * @fileType module
 * @domain chat-plugin-instructions
 * @pattern plugin-manifest
 * @ai-summary Instructions page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "instructions") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { InstructionsPanelView, INSTRUCTIONS_PANEL_TESTID } from "./panel";

export const INSTRUCTIONS_PLUGIN_ID = "instructions";
export const INSTRUCTIONS_PANEL_ID = "instructions";

export const instructionsChatPlugin: ChatPlugin = {
  id: INSTRUCTIONS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: INSTRUCTIONS_PANEL_ID,
      title: "Instructions",
      render: InstructionsPanelView,
    },
  ],
};

export { INSTRUCTIONS_PANEL_TESTID, InstructionsPanelView };
