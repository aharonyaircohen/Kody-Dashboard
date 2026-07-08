/**
 * @fileType module
 * @domain chat-plugin-files
 * @pattern plugin-manifest
 * @ai-summary Files page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "files") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { FilesPanelView, FILES_PANEL_TESTID } from "./panel";

export const FILES_PLUGIN_ID = "files";
export const FILES_PANEL_ID = "files";

export const filesChatPlugin: ChatPlugin = {
  id: FILES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: FILES_PANEL_ID,
      title: "Files",
      render: FilesPanelView,
    },
  ],
};

export { FILES_PANEL_TESTID, FilesPanelView };
