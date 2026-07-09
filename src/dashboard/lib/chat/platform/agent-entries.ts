/**
 * @fileType config
 * @domain kody
 * @pattern chat-entry-list
 * @ai-summary Builds the selectable chat agent/model entry list (Live variant +
 *   Brain variant + user-managed models) shared by the chat picker (KodyChat)
 *   and the Settings "Default chat" selector. Pure — no React, no fetch, no
 *   localStorage.
 */

import { AGENTS, type AgentConfig, type AgentId } from "../../agents";
import {
  resolveReasoning,
  type ModelReasoning,
} from "../core/reasoning-adapter";

/** A single selectable row in the chat agent picker. */
export interface ChatDropdownEntry {
  key: string;
  agentId: AgentId;
  modelId: string | null;
  name: string;
  description: string;
  icon: AgentConfig["icon"];
  /**
   * Effective thinking config for this entry. `null` when the model has
   * no `reasoning` block AND the model-name auto-detect couldn't pick
   * one — the chat header hides the `🧠` dropdown in that case.
   * Surfaced here so the UI never reaches into the raw `ChatModel` list.
   */
  reasoning: ModelReasoning | null;
}

/** A user-managed chat model from /api/kody/models (LLM_MODELS variable). */
export interface ChatModelEntry {
  id: string;
  label: string;
  enabled?: boolean;
  speech?: boolean;
  default?: boolean;
}

/** True when an entry key depends on the async /api/kody/models list. */
export function isModelBackedEntryKey(
  key: string | null | undefined,
): key is `kody:${string}` {
  return typeof key === "string" && key.startsWith("kody:");
}

/**
 * A saved gateway-model pick cannot be resolved until the async models list
 * finishes loading. Static agent picks can resolve from the built-in entries.
 */
export function shouldWaitForModelBackedEntryResolution({
  sessionHydrated,
  chatModelsLoaded,
  sessionAgentKey,
}: {
  sessionHydrated: boolean;
  chatModelsLoaded: boolean;
  sessionAgentKey: string | null | undefined;
}): boolean {
  if (!sessionHydrated) return true;
  if (chatModelsLoaded) return false;
  return !sessionAgentKey || isModelBackedEntryKey(sessionAgentKey);
}

/**
 * Build the ordered list of selectable chat entries.
 *
 * Every row the user can pick from shows up here — including Live. The chat's
 * internal default is `selectedAgentId="kody-live"`, and the previous version
 * of this list deliberately omitted Live so the user couldn't see or change
 * it from the picker. That was wrong: when the user opens the dashboard, the
 * chat is in a "Live" state they didn't ask for, and the only way to know is
 * to scroll past the composer dot. The visible row now matches the actual
 * state, and a Live runner only starts when the user actually picks it
 * (or types and sends, which auto-starts a one-shot session per the existing
 * /interactive/start flow).
 *
 * Brain row: offer Repo Brain only when the repo has FLY_API_TOKEN *and* the
 * per-repo `brainFlyChatEnabled` toggle is on (Settings -> Repo Brain on Fly,
 * default off). Fly task *execution* is independent and still keys off
 * FLY_API_TOKEN alone - this flag is chat-only. Otherwise fall back to the
 * manual Brain (URL+key via Settings). Same single-slot rule as Live - one or
 * the other, never both.
 */
export function buildAgentList(
  brainConfigured: boolean,
  flyConfigured: boolean,
  brainFlyChatEnabled: boolean,
  models: ChatModelEntry[],
): ChatDropdownEntry[] {
  const entries: ChatDropdownEntry[] = [];
  // Live (long-lived runner) — always offered. Fly variant when the repo has
  // FLY_API_TOKEN; otherwise the standard GitHub Actions runner.
  if (flyConfigured) {
    const liveFly = AGENTS["kody-live-fly"];
    entries.push({
      key: "kody-live-fly",
      agentId: "kody-live-fly",
      modelId: null,
      name: liveFly.name,
      description: liveFly.description,
      icon: liveFly.icon,
      reasoning: null,
    });
  } else {
    const live = AGENTS["kody-live"];
    entries.push({
      key: "kody-live",
      agentId: "kody-live",
      modelId: null,
      name: live.name,
      description: live.description,
      icon: live.icon,
      reasoning: null,
    });
  }
  if (flyConfigured && brainFlyChatEnabled) {
    const brainFly = AGENTS["brain-fly"];
    entries.push({
      key: "brain-fly",
      agentId: "brain-fly",
      modelId: null,
      name: brainFly.name,
      description: brainFly.description,
      icon: brainFly.icon,
      reasoning: null,
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
      reasoning: null,
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
      reasoning: resolveReasoning(m),
    });
  }
  return entries;
}
