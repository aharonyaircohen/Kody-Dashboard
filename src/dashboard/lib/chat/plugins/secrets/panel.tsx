/**
 * @fileType component
 * @domain chat-plugin-secrets
 * @pattern plugin-panel-view
 * @ai-summary Secrets panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { SecretsManager } from "../../../components/SecretsManager";
import type { ChatPanelViewProps } from "../../platform";

export const SECRETS_PANEL_TESTID = "chat-panel-secrets";

export function SecretsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={SECRETS_PANEL_TESTID}>
      <SecretsManager />
    </div>
  );
}
