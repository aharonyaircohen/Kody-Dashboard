/**
 * @fileType module
 * @domain chat-plugin-reports
 * @pattern plugin-manifest
 * @ai-summary Reports page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "reports") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { ReportsPanelView, REPORTS_PANEL_TESTID } from "./panel";

export const REPORTS_PLUGIN_ID = "reports";
export const REPORTS_PANEL_ID = "reports";

export const reportsChatPlugin: ChatPlugin = {
  id: REPORTS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: REPORTS_PANEL_ID,
      title: "Reports",
      render: ReportsPanelView,
    },
  ],
};

export { REPORTS_PANEL_TESTID, ReportsPanelView };
