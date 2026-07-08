/**
 * @fileType module
 * @domain chat-plugin-docs
 * @pattern plugin-manifest
 * @ai-summary Docs page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "docs") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const DOCS_PLUGIN_ID = "docs";
export const DOCS_PANEL_ID = "docs";

export const docsChatPlugin: ChatPlugin = {
  id: DOCS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: DOCS_PANEL_ID,
      title: "Docs",
      render: createLazyPanel(
        "docs",
        () => import("./panel").then((m) => ({ default: m.DocsPanelView })),
      ),
    },
  ],
};

