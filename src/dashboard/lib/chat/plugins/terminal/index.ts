/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern plugin-manifest
 * @ai-summary Terminal chat plugin barrel (Step 5a). The manifest lives in
 *   plugin.ts (leaf module) and contributes the exclusive "terminal" display
 *   mode plus the terminal-intent send middleware (order 100 — before slash
 *   expansion at 200). The terminal chrome (mode toggle, toolbars) stays
 *   host-passed ReactNodes built from this plugin's components so the admin
 *   DOM is byte-identical (see TerminalControls.tsx). Registration is
 *   HOST-owned (Step 6 / M6): ChatRailShell's two mounts and GoalControl's
 *   planner dialog pass this plugin; ClientChatSurface never imports it.
 *   Brain terminal coupling (BRAIN_TERMINAL_TRANSPORT, brain image saves)
 *   stays INSIDE this plugin by decision — brain is not a plugin (plan M2).
 *   BUNDLE CAVEAT (Step 7): this barrel statically reaches the heavy render
 *   halves (ChatTerminalSurface, TerminalControls). App code must NOT
 *   import it — hosts take the manifest from ./plugin, KodyChat deep-imports
 *   the helper leaves and lazy-loads the components. Tests may import the
 *   barrel freely.
 */
export { TERMINAL_DISPLAY_MODE, TERMINAL_PLUGIN_ID } from "./mode";
export { terminalChatPlugin } from "./plugin";

export {
  TERMINAL_INTENT_EFFECT,
  TERMINAL_INTENT_MIDDLEWARE_ID,
  TERMINAL_INTENT_MIDDLEWARE_ORDER,
  readTerminalIntentEffect,
  terminalIntentMiddleware,
  type TerminalIntentEffectPayload,
} from "./intent-middleware";
export {
  ChatTerminalSurface,
  type ChatTerminalSurfaceHandle,
} from "./ChatTerminalSurface";
export type {
  ChatTerminalChromeState,
  ChatTerminalConnectionState,
  ChatTerminalMode,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
  MountedChatTerminal,
} from "./types";
export { useChatTerminalRegistry } from "./useChatTerminalRegistry";
export {
  BRAIN_TERMINAL_TRANSPORT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  findMountedBrainTerminal,
  isBrainTerminalTransport,
  normalizeMountedChatTerminals,
  normalizeTerminalTransport,
  reconcileMountedChatTerminalsWithInventory,
  terminalFlyMachineKey,
  terminalMachineIdShort,
  upsertMountedChatTerminal,
} from "./registry-state";
export {
  checkpointTransportFromChatTransport,
  shouldLoadTerminalCheckpoint,
  terminalCheckpointLoadKey,
  terminalCheckpointSearchParams,
} from "./checkpoints";
export {
  TerminalBottomControls,
  TerminalModeToggle,
  TerminalTopControls,
} from "./TerminalControls";
export { useBrainImageSave } from "./use-brain-image-save";
