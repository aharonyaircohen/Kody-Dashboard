/**
 * @fileType module
 * @domain chat-plugin-company
 * @pattern plugin-manifest
 * @ai-summary AI Agency page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "company") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const COMPANY_PLUGIN_ID = "company";
export const COMPANY_PANEL_ID = "company";

export const companyChatPlugin: ChatPlugin = {
  id: COMPANY_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: COMPANY_PANEL_ID,
      title: "AI Agency",
      render: createLazyPanel(
        "company",
        () => import("./panel").then((m) => ({ default: m.CompanyPanelView })),
      ),
    },
  ],
};

