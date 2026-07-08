/**
 * @fileType module
 * @domain chat-plugin-todos
 * @pattern plugin-manifest
 * @ai-summary Todos page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "todos") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const TODOS_PLUGIN_ID = "todos";
export const TODOS_PANEL_ID = "todos";

export const todosChatPlugin: ChatPlugin = {
  id: TODOS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: TODOS_PANEL_ID,
      title: "Todos",
      render: createLazyPanel(
        "todos",
        () => import("./panel").then((m) => ({ default: m.TodosPanelView })),
      ),
    },
  ],
};

