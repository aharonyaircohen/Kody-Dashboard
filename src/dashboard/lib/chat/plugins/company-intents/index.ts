/**
 * @fileType module
 * @domain chat-plugin-company-intents
 * @pattern plugin-manifest
 * @ai-summary Intents page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "company-intents") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { CompanyIntentsPanelView, COMPANY_INTENTS_PANEL_TESTID } from "./panel";

export const COMPANY_INTENTS_PLUGIN_ID = "company-intents";
export const COMPANY_INTENTS_PANEL_ID = "company-intents";

export const companyIntentsChatPlugin: ChatPlugin = {
  id: COMPANY_INTENTS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: COMPANY_INTENTS_PANEL_ID,
      title: "Intents",
      render: CompanyIntentsPanelView,
    },
  ],
};

export { COMPANY_INTENTS_PANEL_TESTID, CompanyIntentsPanelView };
