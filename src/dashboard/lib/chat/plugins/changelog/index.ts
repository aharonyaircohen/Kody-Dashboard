/**
 * @fileType module
 * @domain chat-plugin-changelog
 * @pattern plugin-manifest
 * @ai-summary Changelog page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "changelog") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const CHANGELOG_PLUGIN_ID = "changelog";
export const CHANGELOG_PANEL_ID = "changelog";

export const changelogChatPlugin: ChatPlugin = {
  id: CHANGELOG_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: CHANGELOG_PANEL_ID,
      title: "Changelog",
      render: createLazyPanel(
        "changelog",
        () => import("./panel").then((m) => ({ default: m.ChangelogPanelView })),
      ),
    },
  ],
};

