/**
 * @fileType module
 * @domain chat-plugin-secrets
 * @pattern plugin-manifest
 * @ai-summary Secrets page-plugin (phase 2 step 4 — tasks-pilot recipe).
 *   Contributes exactly one panel view (id "secrets") that the flipped
 *   shell renders in place of the raw route children; the route keeps
 *   rendering the same component, so with the chat-first toggle OFF
 *   nothing changes anywhere. Server half intentionally absent (honest
 *   boundary — see the tasks pilot manifest).
 */
import type { ChatPlugin } from "../../platform";
import { SecretsPanelView, SECRETS_PANEL_TESTID } from "./panel";

export const SECRETS_PLUGIN_ID = "secrets";
export const SECRETS_PANEL_ID = "secrets";

export const secretsChatPlugin: ChatPlugin = {
  id: SECRETS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: SECRETS_PANEL_ID,
      title: "Secrets",
      render: SecretsPanelView,
    },
  ],
};

export { SECRETS_PANEL_TESTID, SecretsPanelView };
