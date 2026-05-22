/**
 * @fileType config
 * @domain kody
 * @pattern chat-entry-list
 * @ai-summary Builds the selectable chat agent/model entry list (Brain variant +
 *   user-managed models) shared by the chat picker (KodyChat) and the Settings
 *   "Default chat" selector. Pure — no React, no fetch, no localStorage.
 */

import { AGENTS, type AgentConfig, type AgentId } from "../agents";

/** A single selectable row in the chat agent picker. */
export interface ChatDropdownEntry {
  key: string;
  agentId: AgentId;
  modelId: string | null;
  name: string;
  description: string;
  icon: AgentConfig["icon"];
}

/** A user-managed chat model from /api/kody/models (LLM_MODELS variable). */
export interface ChatModelEntry {
  id: string;
  label: string;
  enabled?: boolean;
  speech?: boolean;
  default?: boolean;
}

/**
 * Build the ordered list of selectable chat entries.
 *
 * Live is intentionally absent — it still exists as the vibe execution
 * backend (see vibe_start_execution → switch_agent directive), but users
 * don't pick it manually; the runner choice is derived from Settings → Fly
 * Runner (Fly token present → kody-live-fly, else kody-live). Keeping it out
 * removes the confusion between Brain (chat) and Live (action).
 *
 * Brain row: offer Brain on Fly only when the repo has FLY_API_TOKEN *and* the
 * per-repo `brainFlyChatEnabled` toggle is on (Settings → Brain on Fly, default
 * off). Fly task *execution* is independent and still keys off FLY_API_TOKEN
 * alone — this flag is chat-only. Otherwise fall back to the manual Brain
 * (URL+key via Settings). Same single-slot rule as Live — one or the other,
 * never both.
 */
export function buildAgentList(
  brainConfigured: boolean,
  flyConfigured: boolean,
  brainFlyChatEnabled: boolean,
  models: ChatModelEntry[],
): ChatDropdownEntry[] {
  const entries: ChatDropdownEntry[] = [];
  if (flyConfigured && brainFlyChatEnabled) {
    const brainFly = AGENTS["brain-fly"];
    entries.push({
      key: "brain-fly",
      agentId: "brain-fly",
      modelId: null,
      name: brainFly.name,
      description: brainFly.description,
      icon: brainFly.icon,
    });
  } else if (brainConfigured) {
    const brain = AGENTS.brain;
    entries.push({
      key: "brain",
      agentId: "brain",
      modelId: null,
      name: brain.name,
      description: brain.description,
      icon: brain.icon,
    });
  }
  // One row per enabled user-managed model. All route through the in-process
  // gateway path (`/api/kody/chat/kody`) with the model id forwarded in the
  // request body.
  const kody = AGENTS.kody;
  for (const m of models) {
    if (m.enabled === false) continue;
    entries.push({
      key: `kody:${m.id}`,
      agentId: "kody",
      modelId: m.id,
      name: m.label,
      description: m.id,
      icon: kody.icon,
    });
  }
  return entries;
}
