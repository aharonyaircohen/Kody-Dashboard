/**
 * @fileType component
 * @domain chat-plugin-context
 * @pattern plugin-panel-view
 * @ai-summary Context panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { ContextControl } from "../../../components/ContextControl";
import type { ChatPanelViewProps } from "../../platform";

export const CONTEXT_PANEL_TESTID = "chat-panel-context";

export function ContextPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={CONTEXT_PANEL_TESTID}>
      <AuthGuard>
        <ContextControl />
      </AuthGuard>
    </div>
  );
}
