/**
 * @fileType module
 * @domain chat-platform
 * @pattern capability-model
 * @ai-summary Capability model for chat plugins. A plugin DECLARES the
 *   capabilities it needs; a surface GRANTS a set when registering it. The
 *   registry refuses contributions outside the declared+granted set.
 *   NOTE: grants gate client-side composition only — they are NOT a
 *   security boundary (see docs/chat-platform-phase1.md, M6).
 */

export const CHAT_CAPABILITIES = [
  /** Render into surface slots (header, composer, messages, footer). */
  "slots",
  /** Contribute server-executed tools to the in-process chat backend. */
  "tools",
  /** Transform or consume outgoing messages before send. */
  "middleware",
  /** Contribute branding: name, accent, logo, welcome text, locale. */
  "theme",
  /** Surface additional agent entries. */
  "agents",
  /** Declare exclusive display modes (e.g. terminal). */
  "display-modes",
  /** Own persisted per-session state under a plugin-owned key. */
  "session-state",
  /** Dispatch effects to the host (scope changes, navigation requests). */
  "host-effects",
] as const;

export type ChatCapability = (typeof CHAT_CAPABILITIES)[number];

export type ChatCapabilityGrant = readonly ChatCapability[];

/** Grant helper for admin-style surfaces that compose everything. */
export const FULL_GRANT: ChatCapabilityGrant = CHAT_CAPABILITIES;

export function isGranted(
  grant: ChatCapabilityGrant,
  capability: ChatCapability,
): boolean {
  return grant.includes(capability);
}

/**
 * The capability each contribution field requires. Kept next to the model so
 * the registry and tests share one source of truth.
 */
export const CONTRIBUTION_CAPABILITIES = {
  slots: "slots",
  middleware: "middleware",
  theme: "theme",
  agents: "agents",
  displayModes: "display-modes",
  sessionState: "session-state",
  hostEffects: "host-effects",
} as const satisfies Record<string, ChatCapability>;
