/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern plugin-manifest
 * @ai-summary Terminal plugin client manifest as a LEAF module (Step 7
 *   bundle check). Hosts (ChatRailShell, GoalControl) import the manifest
 *   from here — not from the barrel — because index.ts statically re-exports
 *   ChatTerminalSurface/TerminalControls, and any static path to those puts
 *   them in a shared sync chunk that the /client route then loads. This file
 *   reaches only the intent middleware + mode constants, so registering the
 *   plugin costs nothing heavy and the surfaces stay React.lazy-only.
 */
import type { ChatPlugin } from "../../platform";
import { terminalIntentMiddleware } from "./intent-middleware";
import { TERMINAL_DISPLAY_MODE, TERMINAL_PLUGIN_ID } from "./mode";

export const terminalChatPlugin: ChatPlugin = {
  id: TERMINAL_PLUGIN_ID,
  capabilities: ["display-modes", "middleware", "host-effects"],
  displayModes: [{ id: TERMINAL_DISPLAY_MODE, priority: 10 }],
  middleware: [terminalIntentMiddleware],
};
