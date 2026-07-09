/**
 * @fileType module
 * @domain chat-plugin-tasks
 * @pattern plugin-manifest
 * @ai-summary Tasks page-plugin (phase 2 step 3 — the PILOT page plugin).
 *   Contributes exactly one panel view (id "tasks") that the flipped shell
 *   renders in place of the raw /tasks route children; the /tasks route
 *   itself keeps rendering the same component, so with the chat-first
 *   toggle OFF nothing changes anywhere.
 *
 *   Server half is intentionally ABSENT (honest boundary): the in-process
 *   kody backend already ships full task tools via
 *   app/api/kody/chat/tools/task-tools.ts (createTaskTools, wired in
 *   app/api/kody/chat/kody/route.ts). Duplicating them behind the plugin
 *   server-tool registry would create two sources of truth for the same
 *   tools — so this manifest declares only the "panels" capability and no
 *   "tools". If/when the task tools migrate INTO the plugin (a later
 *   step), the capability list grows then.
 *
 *   Registration is HOST-owned (Step 6): ChatRailShell's admin surface
 *   passes this plugin; ClientChatSurface does not (no admin task board on
 *   client brand surfaces).
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const TASKS_PLUGIN_ID = "tasks";
export const TASKS_PANEL_ID = "tasks";

export const tasksChatPlugin: ChatPlugin = {
  id: TASKS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: TASKS_PANEL_ID,
      title: "Tasks",
      render: createLazyPanel("tasks", () =>
        import("./panel").then((m) => ({ default: m.TasksPanelView })),
      ),
    },
  ],
};
