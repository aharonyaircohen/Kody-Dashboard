/**
 * @fileType component
 * @domain chat-plugin-company-intents
 * @pattern plugin-panel-view
 * @ai-summary Intents panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { CompanyIntentsView } from "../../../components/CompanyIntentsView";
import type { ChatPanelViewProps } from "../../platform";

export const COMPANY_INTENTS_PANEL_TESTID = "chat-panel-company-intents";

export function CompanyIntentsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={COMPANY_INTENTS_PANEL_TESTID}>
      <CompanyIntentsView />
    </div>
  );
}
