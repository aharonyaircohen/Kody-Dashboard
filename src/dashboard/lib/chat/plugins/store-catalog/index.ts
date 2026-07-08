/**
 * @fileType module
 * @domain chat-plugin-store-catalog
 * @pattern plugin-manifest
 * @ai-summary Store Catalog page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "store-catalog") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { StoreCatalogPanelView, STORE_CATALOG_PANEL_TESTID } from "./panel";

export const STORE_CATALOG_PLUGIN_ID = "store-catalog";
export const STORE_CATALOG_PANEL_ID = "store-catalog";

export const storeCatalogChatPlugin: ChatPlugin = {
  id: STORE_CATALOG_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: STORE_CATALOG_PANEL_ID,
      title: "Store Catalog",
      render: StoreCatalogPanelView,
    },
  ],
};

export { STORE_CATALOG_PANEL_TESTID, StoreCatalogPanelView };
