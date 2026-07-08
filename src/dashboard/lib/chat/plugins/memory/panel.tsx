/**
 * @fileType component
 * @domain chat-plugin-memory
 * @pattern plugin-panel-view
 * @ai-summary Memory panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { AuthGuard } from "../../../auth-guard";
import { MemoryManager } from "../../../components/MemoryManager";
import type { ChatPanelViewProps } from "../../platform";

export const MEMORY_PANEL_TESTID = "chat-panel-memory";

export function MemoryPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={MEMORY_PANEL_TESTID}>
      <AuthGuard>
        <MemoryManager />
      </AuthGuard>
    </div>
  );
}
