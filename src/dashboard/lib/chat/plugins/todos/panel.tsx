/**
 * @fileType component
 * @domain chat-plugin-todos
 * @pattern plugin-panel-view
 * @ai-summary Todos panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { TodoControl } from "../../../components/TodoControl";
import type { ChatPanelViewProps } from "../../platform";

export const TODOS_PANEL_TESTID = "chat-panel-todos";

export function TodosPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={TODOS_PANEL_TESTID}>
      <AuthGuard>
        <TodoControl />
      </AuthGuard>
    </div>
  );
}
