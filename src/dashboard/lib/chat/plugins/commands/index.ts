/**
 * @fileType module
 * @domain chat-plugin-commands
 * @pattern plugin-manifest
 * @ai-summary Commands chat plugin (Step 5b). The manifest contributes the
 *   slash-expansion send middleware (order 200 — after terminal intent at
 *   100). The slash menu stays a host-passed ReactNode built from this
 *   plugin's SlashCommandMenu (position-coupled to the composer textarea,
 *   same decision as the terminal chrome) so the admin DOM is
 *   byte-identical. The host feeds the fetched command list through the
 *   host-context snapshot (`slashCommands` key) and reads the raw-typed
 *   text back from the expansion host effect for the user bubble. The
 *   commands DATA layer (`lib/commands/{files,index,substitute}.ts` + API
 *   routes) is shared with the /commands page and stays outside chat/.
 */
import type { ChatPlugin } from "../../platform";
import { slashExpansionMiddleware } from "./expansion-middleware";

export const COMMANDS_PLUGIN_ID = "commands";

export const commandsChatPlugin: ChatPlugin = {
  id: COMMANDS_PLUGIN_ID,
  capabilities: ["middleware", "host-effects"],
  middleware: [slashExpansionMiddleware],
};

export {
  SLASH_COMMANDS_HOST_KEY,
  SLASH_EXPANSION_EFFECT,
  SLASH_EXPANSION_MIDDLEWARE_ID,
  SLASH_EXPANSION_MIDDLEWARE_ORDER,
  readHostSlashCommands,
  readSlashExpansionEffect,
  slashExpansionMiddleware,
  type SlashExpansionEffectPayload,
} from "./expansion-middleware";
export {
  expandSlashCommand,
  parseSlashTrigger,
  slashCommandsQueryKey,
  useSlashCommands,
  type SlashCommand,
} from "./useSlashCommands";
export { SlashCommandMenu, filterCommands } from "./SlashCommandMenu";
