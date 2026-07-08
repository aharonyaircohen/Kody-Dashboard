/**
 * @fileType component
 * @domain chat-plugin-company
 * @pattern plugin-panel-view
 * @ai-summary AI Agency panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { AgencyArchitect } from "../../../components/AgencyArchitect";
import type { ChatPanelViewProps } from "../../platform";

export const COMPANY_PANEL_TESTID = "chat-panel-company";

export function CompanyPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={COMPANY_PANEL_TESTID}>
      <AuthGuard>
        <AgencyArchitect />
      </AuthGuard>
    </div>
  );
}
