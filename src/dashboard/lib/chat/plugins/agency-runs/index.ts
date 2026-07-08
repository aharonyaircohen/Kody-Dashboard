/**
 * @fileType module
 * @domain chat-plugin-agency-runs
 * @pattern plugin-manifest
 * @ai-summary Agency Runs page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "agency-runs") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { AgencyRunsPanelView, AGENCY_RUNS_PANEL_TESTID } from "./panel";

export const AGENCY_RUNS_PLUGIN_ID = "agency-runs";
export const AGENCY_RUNS_PANEL_ID = "agency-runs";

export const agencyRunsChatPlugin: ChatPlugin = {
  id: AGENCY_RUNS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: AGENCY_RUNS_PANEL_ID,
      title: "Agency Runs",
      render: AgencyRunsPanelView,
    },
  ],
};

export { AGENCY_RUNS_PANEL_TESTID, AgencyRunsPanelView };
