/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern plugin-constants
 * @ai-summary Leaf module for the terminal plugin's identity constants.
 *   Split out of index.ts (Step 7 bundle check) so hosts that need only the
 *   display-mode id (KodyChat's mode arbitration) can deep-import it without
 *   pulling the barrel — the barrel statically reaches ChatTerminalSurface
 *   and TerminalControls, which must stay out of the /client route chunk.
 */

export const TERMINAL_PLUGIN_ID = "terminal";
export const TERMINAL_DISPLAY_MODE = "terminal";
