/**
 * @fileType module
 * @domain chat-platform
 * @pattern plugin-contract
 * @ai-summary The ChatPlugin client manifest (plan H2/H3): slots + tools
 *   metadata PLUS the hooks the real features need — ordered send
 *   middleware, per-session plugin state, host-context/effect channels, and
 *   exclusive display modes. Server-executed tool factories live in a
 *   separate server module (tools.ts) and never enter the client bundle.
 */
import type { ComponentType } from "react";

import type { ChatCapability } from "./capabilities";

/** Where a plugin can render. The surface owns the physical layout. */
export type ChatSlotId =
  | "header-actions"
  | "composer-actions"
  | "composer-leading"
  | "message-renderer"
  | "footer";

export interface ChatSlotProps {
  /** Host context snapshot at render time (read-only). */
  host: Readonly<Record<string, unknown>>;
}

export interface ChatSlotContribution {
  slot: ChatSlotId;
  /** Stable id for tests and ordering diagnostics. */
  id: string;
  component: ComponentType<ChatSlotProps>;
}

/**
 * Send middleware — runs over the outgoing text before transport. Ordering
 * is deterministic: ascending `order`, ties broken by plugin id. Today's
 * pinned precedence: terminal intent (order 100) before slash expansion
 * (order 200).
 */
export interface ChatSendMiddlewareContext {
  host: Readonly<Record<string, unknown>>;
  dispatchHostEffect: (effect: ChatHostEffect) => void;
}

export interface ChatSendMiddlewareResult {
  /** Replacement text (omit to leave unchanged). */
  text?: string;
  /** True = message fully handled; stop the chain, do not send. */
  consumed?: boolean;
}

export interface ChatSendMiddleware {
  id: string;
  order: number;
  onSend(
    text: string,
    ctx: ChatSendMiddlewareContext,
  ): ChatSendMiddlewareResult | null;
}

/** Per-session state owned by a plugin (its own storage key + codec). */
export interface ChatSessionStateSpec {
  key: string;
  parse(raw: string | null): unknown;
  serialize(value: unknown): string;
}

/**
 * Exclusive display modes (plan H2d): plugins declare; the PLATFORM
 * arbitrates. The host may force a mode (vibe forces "ai"), which always
 * wins — so mode suppression never becomes a plugin→plugin import.
 */
export interface ChatDisplayMode {
  id: string;
  priority: number;
}

export interface ChatThemeContribution {
  name?: string;
  accent?: string;
  logoUrl?: string;
  welcomeText?: string;
  locale?: string;
}

/** Effects a plugin dispatches to the host (scope change, navigation…). */
export interface ChatHostEffect {
  kind: string;
  payload?: unknown;
}

/**
 * The client-side plugin manifest. Everything here is renderable/pure —
 * server tool factories are registered separately (see tools.ts) so tool
 * handlers never ship to the browser.
 */
export interface ChatPlugin {
  id: string;
  /** Capabilities this plugin requires; must be ⊆ the surface's grant. */
  capabilities: readonly ChatCapability[];
  slots?: readonly ChatSlotContribution[];
  middleware?: readonly ChatSendMiddleware[];
  sessionState?: readonly ChatSessionStateSpec[];
  displayModes?: readonly ChatDisplayMode[];
  theme?: ChatThemeContribution;
  /** Additional agent ids this plugin surfaces in the picker. */
  agents?: readonly string[];
  /** i18n messages, auto-namespaced as `plugin.<id>.<key>`. */
  messages?: Readonly<Record<string, string>>;
}
