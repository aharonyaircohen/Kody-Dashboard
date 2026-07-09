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
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const STORE_CATALOG_PLUGIN_ID = "store-catalog";
export const STORE_CATALOG_PANEL_ID = "store-catalog";

export const storeCatalogChatPlugin: ChatPlugin = {
  id: STORE_CATALOG_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: STORE_CATALOG_PANEL_ID,
      title: "Store Catalog",
      render: createLazyPanel("store-catalog", () =>
        import("./panel").then((m) => ({ default: m.StoreCatalogPanelView })),
      ),
    },
  ],
};
