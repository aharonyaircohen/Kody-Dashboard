/**
 * @fileType module
 * @domain chat-plugin-settings
 * @pattern plugin-manifest
 * @ai-summary Settings page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "settings") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { SettingsPanelView, SETTINGS_PANEL_TESTID } from "./panel";

export const SETTINGS_PLUGIN_ID = "settings";
export const SETTINGS_PANEL_ID = "settings";

export const settingsChatPlugin: ChatPlugin = {
  id: SETTINGS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: SETTINGS_PANEL_ID,
      title: "Settings",
      render: SettingsPanelView,
    },
  ],
};

export { SETTINGS_PANEL_TESTID, SettingsPanelView };
