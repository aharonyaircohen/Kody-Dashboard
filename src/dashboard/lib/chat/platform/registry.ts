/**
 * @fileType module
 * @domain chat-platform
 * @pattern plugin-registry
 * @ai-summary Per-instance plugin registry (plan H4: KodyChat mounts twice,
 *   so registries are created PER MOUNT; plugin manifests stay global pure
 *   data). Registration validates: unique id, contributions covered by the
 *   plugin's declared capabilities, declared capabilities covered by the
 *   surface's grant. All reads return new arrays (immutability rule).
 */

import {
  CONTRIBUTION_CAPABILITIES,
  isGranted,
  type ChatCapability,
  type ChatCapabilityGrant,
} from "./capabilities";
import type {
  ChatHostEffect,
  ChatPanelView,
  ChatPlugin,
  ChatSendMiddleware,
  ChatSendMiddlewareContext,
  ChatSlotContribution,
  ChatSlotId,
  ChatThemeContribution,
} from "./types";

export class ChatPluginRegistrationError extends Error {
  constructor(
    readonly pluginId: string,
    readonly violations: readonly string[],
  ) {
    super(`Chat plugin "${pluginId}" rejected: ${violations.join("; ")}`);
    this.name = "ChatPluginRegistrationError";
  }
}

interface RegisteredPlugin {
  plugin: ChatPlugin;
  grant: ChatCapabilityGrant;
}

export interface ChatSendOutcome {
  text: string;
  consumedBy?: string;
}

function contributionViolations(
  plugin: ChatPlugin,
  grant: ChatCapabilityGrant,
): string[] {
  const violations: string[] = [];
  const need = (
    field: string,
    capability: ChatCapability,
    present: boolean,
  ) => {
    if (!present) return;
    if (!plugin.capabilities.includes(capability)) {
      violations.push(
        `contributes ${field} without declaring capability "${capability}"`,
      );
    }
  };
  need("slots", CONTRIBUTION_CAPABILITIES.slots, !!plugin.slots?.length);
  need(
    "middleware",
    CONTRIBUTION_CAPABILITIES.middleware,
    !!plugin.middleware?.length,
  );
  need("theme", CONTRIBUTION_CAPABILITIES.theme, plugin.theme !== undefined);
  need("agents", CONTRIBUTION_CAPABILITIES.agents, !!plugin.agents?.length);
  need(
    "displayModes",
    CONTRIBUTION_CAPABILITIES.displayModes,
    !!plugin.displayModes?.length,
  );
  need(
    "sessionState",
    CONTRIBUTION_CAPABILITIES.sessionState,
    !!plugin.sessionState?.length,
  );
  need("panels", CONTRIBUTION_CAPABILITIES.panels, !!plugin.panels?.length);
  for (const capability of plugin.capabilities) {
    if (!isGranted(grant, capability)) {
      violations.push(`capability "${capability}" is not granted`);
    }
  }
  return violations;
}

export interface ChatPluginRegistry {
  register(plugin: ChatPlugin, grant: ChatCapabilityGrant): void;
  pluginIds(): string[];
  slots(slot: ChatSlotId): ChatSlotContribution[];
  middleware(): ChatSendMiddleware[];
  /** Side-panel views in registration order (phase 2 step 2). */
  panels(): ChatPanelView[];
  runSendMiddleware(
    text: string,
    ctx: ChatSendMiddlewareContext,
  ): ChatSendOutcome;
  /** Later registration wins per field — deterministic merge. */
  theme(): ChatThemeContribution;
  agents(): string[];
  /** `plugin.<id>.<key>` → message, for the i18n catalog. */
  messages(): Record<string, string>;
  /**
   * Display-mode arbitration: `forced` (host, e.g. vibe) always wins;
   * otherwise the highest-priority registered mode among `requested`,
   * falling back to "ai".
   */
  resolveDisplayMode(requested: readonly string[], forced?: string): string;
  dispatchHostEffect(effect: ChatHostEffect): void;
  onHostEffect(listener: (effect: ChatHostEffect) => void): () => void;
}

export function createChatPluginRegistry(): ChatPluginRegistry {
  const plugins = new Map<string, RegisteredPlugin>();
  const effectListeners = new Set<(effect: ChatHostEffect) => void>();

  const orderedPlugins = () => [...plugins.values()].map((r) => r.plugin);

  return {
    register(plugin, grant) {
      const violations: string[] = [];
      if (plugins.has(plugin.id)) violations.push("duplicate plugin id");
      violations.push(...contributionViolations(plugin, grant));
      if (violations.length > 0) {
        throw new ChatPluginRegistrationError(plugin.id, violations);
      }
      plugins.set(plugin.id, { plugin, grant });
    },

    pluginIds() {
      return [...plugins.keys()];
    },

    slots(slot) {
      return orderedPlugins().flatMap(
        (p) => p.slots?.filter((s) => s.slot === slot) ?? [],
      );
    },

    panels() {
      return orderedPlugins().flatMap((p) => (p.panels ? [...p.panels] : []));
    },

    middleware() {
      return orderedPlugins()
        .flatMap((p) => (p.middleware ?? []).map((m) => ({ plugin: p.id, m })))
        .sort(
          (a, b) => a.m.order - b.m.order || a.plugin.localeCompare(b.plugin),
        )
        .map((x) => x.m);
    },

    runSendMiddleware(text, ctx) {
      let current = text;
      for (const mw of this.middleware()) {
        const result = mw.onSend(current, ctx);
        if (!result) continue;
        if (typeof result.text === "string") current = result.text;
        if (result.consumed) return { text: current, consumedBy: mw.id };
      }
      return { text: current };
    },

    theme() {
      return orderedPlugins().reduce<ChatThemeContribution>(
        (merged, p) => (p.theme ? { ...merged, ...p.theme } : merged),
        {},
      );
    },

    agents() {
      return orderedPlugins().flatMap((p) => p.agents ?? []);
    },

    messages() {
      const out: Record<string, string> = {};
      for (const p of orderedPlugins()) {
        for (const [key, value] of Object.entries(p.messages ?? {})) {
          out[`plugin.${p.id}.${key}`] = value;
        }
      }
      return out;
    },

    resolveDisplayMode(requested, forced) {
      if (forced) return forced;
      const declared = orderedPlugins()
        .flatMap((p) => p.displayModes ?? [])
        .filter((mode) => requested.includes(mode.id))
        .sort((a, b) => b.priority - a.priority);
      return declared[0]?.id ?? "ai";
    },

    dispatchHostEffect(effect) {
      for (const listener of effectListeners) listener(effect);
    },

    onHostEffect(listener) {
      effectListeners.add(listener);
      return () => effectListeners.delete(listener);
    },
  };
}
