/**
 * @fileType component
 * @domain chat-plugin-settings
 * @pattern plugin-panel-view
 * @ai-summary Settings panel view (phase 2 step 4). Renders the SAME tree
 *   the route renders — the plugin WRAPS the page's inner component, it
 *   does not fork it. The `display: contents` wrapper is only a stable
 *   marker proving the flipped shell rendered the plugin's view; it adds
 *   no layout, so the rendered page is byte-identical to the route's.
 */
"use client";

import { SettingsManager } from "../../../components/SettingsManager";
import type { ChatPanelViewProps } from "../../platform";

export const SETTINGS_PANEL_TESTID = "chat-panel-settings";

export function SettingsPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={SETTINGS_PANEL_TESTID}>
      <SettingsManager />
    </div>
  );
}
