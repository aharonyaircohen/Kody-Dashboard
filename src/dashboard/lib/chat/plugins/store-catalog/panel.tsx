/**
 * @fileType component
 * @domain chat-plugin-store-catalog
 * @pattern plugin-panel-view
 * @ai-summary Store Catalog panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { StoreCatalogManager } from "../../../components/StoreCatalogManager";
import type { ChatPanelViewProps } from "../../platform";

export const STORE_CATALOG_PANEL_TESTID = "chat-panel-store-catalog";

export function StoreCatalogPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={STORE_CATALOG_PANEL_TESTID}>
      <AuthGuard>
        <StoreCatalogManager />
      </AuthGuard>
    </div>
  );
}
