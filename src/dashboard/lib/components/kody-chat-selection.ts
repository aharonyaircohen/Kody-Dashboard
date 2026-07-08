/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-selection
 * @ai-summary Agent/model selection extracted from KodyChat (phase
 *   1.6c): the selected agent/model state, the dropdown entry list,
 *   default-agent resolution, family snap for removed entries,
 *   reasoning-effort wiring, the lockedAgentId sync, and the
 *   per-session agent sync effect. Behavior is identical to the
 *   pre-extraction inline code — the picker/JSX writes (onSelectEntry,
 *   "New conversation" seeding) stay in KodyChat and call the setters
 *   returned here.
 *
 *   Placement note: lives in components/ next to the other phase-1.6
 *   extractions (kody-chat-live-runner.ts / kody-chat-send.ts /
 *   kody-chat-data.ts) — it is KodyChat wiring, not chat/core logic.
 *   The pure decisions (default resolution, family snap) are exported
 *   as plain functions so they unit-test without a renderer.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENT_KODY, AGENTS, type AgentConfig, type AgentId } from "../agents";
import {
  buildAgentList,
  shouldWaitForModelBackedEntryResolution,
  type ChatDropdownEntry,
  type ChatModelEntry,
} from "../chat/platform/agent-entries";
import { readDefaultChatEntry } from "../chat/platform/default-entry";
import { readReasoningEffort } from "../chat/core/reasoning-pref";
import type { ModelReasoning } from "../chat/core/reasoning-adapter";
import type { UseChatSessionsResult } from "../chat/core/use-chat-sessions";

/**
 * Resolve the global default agent entry — the value a session with
 * no per-session pick falls back to. Used as the catch-all when
 * a session's `agentKey` is missing (legacy sessions created
 * before this field existed) or points at an entry that has
 * since been removed from the list.
 *
 * Resolution order:
 *   1. `defaultChatEntryKey` — Settings → "Default chat" pick.
 *   2. Legacy: a Kody model with `default: true` on the Models page.
 *   3. First configured Kody model.
 *   4. Brain if configured.
 *   5. First valid Live entry (Kody Live, or Live-Fly when on Fly).
 *
 * Renderers are part of the in-process Kody chat protocol. If a repo has
 * a Kody model configured but no saved default, default to that renderer-
 * capable path instead of Live, while still letting Settings override it.
 */
export function resolveDefaultAgentEntry(options: {
  defaultChatEntryKey: string | null;
  chatModels: ChatModelEntry[];
  brainConfigured: boolean;
  agentList: ChatDropdownEntry[];
}): ChatDropdownEntry | null {
  const { defaultChatEntryKey, chatModels, brainConfigured, agentList } =
    options;
  if (defaultChatEntryKey) {
    const entry = agentList.find((e) => e.key === defaultChatEntryKey);
    if (entry) return entry;
  }
  const defModel = chatModels.find(
    (m) => m.default === true && m.enabled !== false,
  );
  if (defModel) {
    const entry = agentList.find((e) => e.key === `kody:${defModel.id}`);
    if (entry) return entry;
  }
  const firstKodyModel = agentList.find((e) => e.agentId === "kody");
  if (firstKodyModel) return firstKodyModel;
  if (brainConfigured) {
    const entry = agentList.find(
      (e) => e.key === "brain" || e.key === "brain-fly",
    );
    if (entry) return entry;
  }
  return (
    agentList.find((e) => e.key === "kody-live-fly" || e.key === "kody-live") ??
    agentList[0] ??
    null
  );
}

/**
 * Family snap. When a probe flips availability (Fly token added/removed,
 * Brain Fly toggle flipped), a session's `agentKey` may point at a
 * dropdown row that's no longer in the list. The same agent is still
 * available under a sibling key (Live ↔ Live-Fly, Brain ↔ Brain-Fly);
 * use that instead of bouncing the user back to a different family.
 * For removed gateway models, fall back to any other Kody row, then
 * Live if no Kody rows exist.
 */
export function familySnapEntry(
  key: string,
  agentList: ChatDropdownEntry[],
): ChatDropdownEntry | null {
  if (key === "kody-live" || key === "kody-live-fly") {
    return (
      agentList.find(
        (e) => e.key === "kody-live-fly" || e.key === "kody-live",
      ) ?? null
    );
  }
  if (key === "brain" || key === "brain-fly") {
    return (
      agentList.find((e) => e.key === "brain-fly" || e.key === "brain") ?? null
    );
  }
  if (key.startsWith("kody:")) {
    return (
      agentList.find((e) => e.agentId === "kody") ??
      agentList.find(
        (e) => e.key === "kody-live-fly" || e.key === "kody-live",
      ) ??
      null
    );
  }
  return null;
}

export interface UseAgentSelectionOptions {
  /** Host pins an agent (e.g. the Vibe page) — the picker is locked. */
  lockedAgentId?: AgentId;
  /** Brain visibility — per-user Settings entry (URL + API key). */
  brainConfigured: boolean;
  /** Per-repo vault FLY_API_TOKEN probe result (kody-chat-data). */
  flyConfigured: boolean;
  /** Repo-wide "Repo Brain" chat row opt-in (kody-chat-data). */
  brainFlyChatEnabled: boolean;
  /** User-managed model list + loaded flag (kody-chat-data). */
  chatModels: ChatModelEntry[];
  chatModelsLoaded: boolean;
  /** The global session store — per-session agent picks live on it. */
  sessionHook: UseChatSessionsResult;
}

export interface UseAgentSelectionResult {
  selectedAgentId: AgentId;
  setSelectedAgentId: React.Dispatch<React.SetStateAction<AgentId>>;
  selectedModelId: string | null;
  setSelectedModelId: React.Dispatch<React.SetStateAction<string | null>>;
  agentMenuOpen: boolean;
  setAgentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningMenuOpen: boolean;
  setReasoningMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReasoningEffort: React.Dispatch<React.SetStateAction<string | null>>;
  /** Static agent record for the selected id (AGENT_KODY fallback). */
  currentAgent: AgentConfig;
  /** Every dropdown row currently available. */
  agentList: ChatDropdownEntry[];
  /** The dropdown row matching the current agent+model pick, if any. */
  currentEntry: ChatDropdownEntry | null;
  /** Effective thinking config for the active model (null = hidden). */
  currentReasoning: ModelReasoning | null;
  /** Resolved effort — session pick > stored pref > model default. */
  effectiveReasoningEffort: string | null;
  /**
   * UI side effects of a live-session restore — flips the picker to the
   * Live agent and mirrors it onto the active session. Passed to
   * useLiveRunner's onRehydrateRestored.
   */
  onRehydrateRestored: () => void;
}

/**
 * Agent/model selection state + sync. The active session's `agentKey`
 * is the source of truth for the visible agent; this hook owns the
 * resolution chain (session pick → family snap → default) and the
 * write-back of resolved picks.
 */
export function useAgentSelection(
  options: UseAgentSelectionOptions,
): UseAgentSelectionResult {
  const {
    lockedAgentId,
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
    chatModelsLoaded,
    sessionHook,
  } = options;

  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(
    lockedAgentId ?? "kody-live",
  );
  // When the user picks a gateway-routed model (any LLM_MODELS entry), the
  // dropdown sets `selectedAgentId='kody'` and stashes the gateway id here.
  // The chat request forwards it as `body.model`. Null = no override.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  // Thinking-level state. The chat header shows a small `🧠` dropdown
  // next to the agent picker when the current model declares a
  // `reasoning` block (or one can be auto-detected from `modelName`).
  // The pick is persisted per (repo, modelId) so switching models
  // doesn't reset your "High" on Claude when you swap to GPT-5. Sent
  // on every chat request as `body.reasoningEffort`; the chat route
  // translates it to the provider's wire shape at request time.
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  // The user-chosen default chat dropdown entry key (any entry: Brain,
  // Brain-Fly, or `kody:<modelId>`), a per-user preference persisted in
  // localStorage (repo-scoped). Read synchronously on mount. Separate from a
  // model's own `default` flag, which governs server-side gateway resolution.
  // Read on mount here; written by Settings → "Default chat". The chat picker
  // stores per-session picks separately.
  const [defaultChatEntryKey] = useState<string | null>(() =>
    readDefaultChatEntry(),
  );

  const currentAgent = AGENTS[selectedAgentId] ?? AGENT_KODY;
  const agentList = buildAgentList(
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
  );

  // What to show in the header — when a gateway model is active, prefer
  // its label over the static `kody` agent name.
  const currentEntry =
    agentList.find(
      (e) =>
        e.agentId === selectedAgentId &&
        (e.modelId ?? null) === selectedModelId,
    ) ?? null;
  // Effective thinking config for the active model. `null` when the model
  // has no `reasoning` block AND the model-name auto-detect couldn't pick
  // one — the header hides the dropdown in that case (no clutter for
  // models that don't reason).
  const currentReasoning = currentEntry?.reasoning ?? null;
  // Resolved effort. Read directly from localStorage on every render so
  // the dropdown never flashes the model's `default` before snapping to
  // the stored pick on mount. The `reasoningEffort` state still wins
  // during the current session (overrides the storage read with the
  // user's just-clicked pick before the localStorage write is observed
  // by React's next render). Per-(repo, modelId) scoping lives in
  // `reasoning-pref.ts`.
  const effectiveReasoningEffort = useMemo(() => {
    if (!currentReasoning) return null;
    if (
      reasoningEffort &&
      currentReasoning.efforts.some((e) => e.value === reasoningEffort)
    ) {
      return reasoningEffort;
    }
    if (selectedModelId) {
      const stored = readReasoningEffort(selectedModelId);
      if (stored && currentReasoning.efforts.some((e) => e.value === stored)) {
        return stored;
      }
    }
    return currentReasoning.default;
  }, [currentReasoning, selectedModelId, reasoningEffort]);

  // Default-entry resolution — see resolveDefaultAgentEntry above.
  const defaultAgentEntry = useMemo<ChatDropdownEntry | null>(
    () =>
      resolveDefaultAgentEntry({
        defaultChatEntryKey,
        chatModels,
        brainConfigured,
        agentList,
      }),
    [defaultChatEntryKey, chatModels, brainConfigured, agentList],
  );

  // Family snap for removed dropdown rows — see familySnapEntry above.
  const familySnap = useCallback(
    (key: string): ChatDropdownEntry | null => familySnapEntry(key, agentList),
    [agentList],
  );

  // When a parent toggles `lockedAgentId` on/off (route change), keep state in sync.
  useEffect(() => {
    if (lockedAgentId && selectedAgentId !== lockedAgentId) {
      setSelectedAgentId(lockedAgentId);
    }
  }, [lockedAgentId, selectedAgentId]);

  // Per-session agent sync. The active session's `agentKey` is the
  // source of truth for the visible agent — switching sessions
  // restores the agent that was active for that thread, and the
  // user's picker write is captured on the session.
  //
  // Three flows collapse into one effect:
  //   1. Session has a valid `agentKey` → adopt it. (Covers session
  //      switches, where the active session changes underneath us.)
  //   2. Session's `agentKey` points at an entry that's no longer
  //      in the list (e.g. FLY_API_TOKEN probe flipped, or the user
  //      removed the model on the Models page) → family snap to
  //      a sibling entry, then default chain.
  //   3. Session has no `agentKey` (legacy session) → use the
  //      default chain and write it back so the next switch
  //      restores it directly. Also covers the "no active session"
  //      case, where the local state is just seeded with the default
  //      (the first send then auto-creates a session and the sync
  //      effect will re-run to capture the pick).
  useEffect(() => {
    if (lockedAgentId) return; // Vibe page owns the agent
    const session = sessionHook.activeSession;
    if (
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: sessionHook.hydrated,
        chatModelsLoaded,
        sessionAgentKey: session?.agentKey,
      })
    ) {
      return;
    }
    if (agentList.length === 0) return; // Wait for the list to load.

    let targetEntry: ChatDropdownEntry | null = null;
    if (session?.agentKey) {
      targetEntry = agentList.find((e) => e.key === session.agentKey) ?? null;
      if (!targetEntry) {
        targetEntry = familySnap(session.agentKey);
      }
    }
    if (!targetEntry) {
      targetEntry = defaultAgentEntry;
    }
    if (!targetEntry) return;

    if (
      targetEntry.agentId !== selectedAgentId ||
      (targetEntry.modelId ?? null) !== selectedModelId
    ) {
      setSelectedAgentId(targetEntry.agentId);
      setSelectedModelId(targetEntry.modelId);
    }

    // Persist the resolved pick on the active session so future
    // switches restore it directly without re-running the fallback
    // chain. Skipped when there's no session (local-state-only
    // adjustment) or when the session already has this key.
    if (session && session.agentKey !== targetEntry.key) {
      sessionHook.setSessionAgent(session.id, targetEntry.key);
    }
  }, [
    sessionHook.activeSession?.id,
    sessionHook.activeSession?.agentKey,
    sessionHook.hydrated,
    agentList,
    defaultAgentEntry,
    familySnap,
    chatModelsLoaded,
    lockedAgentId,
    selectedAgentId,
    selectedModelId,
    sessionHook.setSessionAgent,
  ]);

  // UI side effects of a live-session restore. Runs from the live-runner
  // hook's rehydrateForScope when a saved record exists for the scope.
  const onRehydrateRestored = useCallback(() => {
    setSelectedAgentId("kody-live");
    // Mirror the rehydrated runner agent onto the active session so
    // a refresh / re-open lands back on Kody Live. The Fly variant
    // is also valid here — the entry list is the source of truth
    // for which one is available.
    const rehydrateEntry = agentList.find(
      (e) => e.key === "kody-live-fly" || e.key === "kody-live",
    );
    const rehydrateId = sessionHook.activeSession?.id;
    if (rehydrateId && rehydrateEntry) {
      sessionHook.setSessionAgent(rehydrateId, rehydrateEntry.key);
    }
  }, [agentList, sessionHook]);

  return {
    selectedAgentId,
    setSelectedAgentId,
    selectedModelId,
    setSelectedModelId,
    agentMenuOpen,
    setAgentMenuOpen,
    reasoningMenuOpen,
    setReasoningMenuOpen,
    setReasoningEffort,
    currentAgent,
    agentList,
    currentEntry,
    currentReasoning,
    effectiveReasoningEffort,
    onRehydrateRestored,
  };
}
