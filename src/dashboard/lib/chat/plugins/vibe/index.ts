/**
 * @fileType module
 * @domain chat-plugin-vibe
 * @pattern plugin-manifest
 * @ai-summary Vibe chat plugin (Step 5c, rescoped per the plan's M2
 *   decision: VIBE IS A HOST MODE). This plugin owns only the vibe-specific
 *   pieces that are mechanically separable from the host:
 *
 *   IN this plugin:
 *   - `recent-issue.ts` — the just-created-issue TTL bridge for the
 *     two-turn create→execute flow (moved from lib/vibe/recent-issue.ts).
 *   - `turn-context.ts` — the `vibeMode`/`taskContext` request-body
 *     decoration shared by all four send paths.
 *   - `VIBE_TASK_EMPTY_STATE_HINT` — the vibe variant of the task-scoped
 *     empty-state copy.
 *
 *   HOST/CORE by decision (do NOT move here):
 *   - Mode activation: route-derived `vibeMode` in ChatRailShell, passed
 *     down as a KodyChat prop (frozen ChatRailApi contract, plan H4).
 *   - `ChatSessionScope = 'vibe-default'` (chat/core/use-chat-sessions.ts)
 *     and the live-runner scope keys `vibe-<issue>`/`vibe-default`
 *     (chat/core/kody-chat-live-session.ts `getLiveScopeKey`).
 *   - Display mode: the host FORCES "ai" while in vibe (platform
 *     `resolveDisplayMode(_, "ai")`) — vibe declares no display mode, so
 *     vibe-suppresses-terminal never becomes a plugin→plugin import.
 *   - The /vibe page, VibePage/VibeRunButton/VibeIssueList components, and
 *     the /api/kody/vibe* routes.
 *   - Runner lifecycle glue that vibe merely exercises: the SwitchAgent
 *     auto-kickoff queue (reducer-owned, agent-generic), the live-session
 *     watchdog, and sendText's backend routing.
 *   - Server halves: lib/vibe/primer.ts (engine-prompt primer used by the
 *     trigger/interactive routes) and app/api/kody/chat/kody/
 *     vibe-tool-policy.ts (vibe REMOVES tools rather than contributing
 *     any, so there is no plugin server-tool half to register).
 *
 *   The manifest is intentionally contribution-free (no slots, middleware,
 *   display modes, or tools): vibe behavior is gated on the host's
 *   `vibeMode` prop, which can flip mid-mount as the persistent rail
 *   navigates onto/off /vibe — mount-time registry state must not encode
 *   it. KodyChat registers this plugin on every surface (like commands);
 *   registration is inert and exists to reserve the id and pin the
 *   boundary above.
 */
import type { ChatPlugin } from "../../platform";

export const VIBE_PLUGIN_ID = "vibe";

export const vibeChatPlugin: ChatPlugin = {
  id: VIBE_PLUGIN_ID,
  capabilities: [],
};

/**
 * Task-scoped empty-state copy while in vibe mode. Vibe keeps one visible
 * conversation across issue creation (scope `vibe-default`), so messages do
 * not migrate to a per-task thread the way the admin rail's do.
 */
export const VIBE_TASK_EMPTY_STATE_HINT = "Messages stay in this Vibe thread";

export {
  pickVibeRequestIssueNumber,
  RECENT_VIBE_ISSUE_TTL_MS,
  type RecentVibeIssue,
} from "./recent-issue";
export {
  vibeLiveTaskContext,
  vibeTurnFields,
  type VibeLiveTaskContext,
  type VibeTaskScope,
} from "./turn-context";
