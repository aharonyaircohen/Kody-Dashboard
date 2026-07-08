/**
 * @fileoverview Unit tests for the tasks page-plugin manifest (phase 2
 * step 3 pilot): panels-only capability declaration, the "tasks" panel
 * view contract, registry composition under the admin FULL_GRANT, and
 * rejection when the surface grant lacks "panels". The server half is
 * intentionally absent (task tools already live in the kody route via
 * createTaskTools) — the manifest must NOT declare "tools".
 *
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  TASKS_PANEL_ID,
  TASKS_PLUGIN_ID,
  tasksChatPlugin,
} from "@dashboard/lib/chat/plugins/tasks";
import { FULL_GRANT } from "@dashboard/lib/chat/platform/capabilities";
import {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
} from "@dashboard/lib/chat/platform/registry";

describe("tasks chat plugin manifest", () => {
  it("declares only the panels capability (no server-tool half)", () => {
    expect(tasksChatPlugin.id).toBe(TASKS_PLUGIN_ID);
    expect(tasksChatPlugin.capabilities).toEqual(["panels"]);
    // Honest boundary: task tools already ship in the kody route
    // (createTaskTools) — the plugin must not duplicate them.
    expect(tasksChatPlugin.capabilities).not.toContain("tools");
    expect(tasksChatPlugin.slots).toBeUndefined();
    expect(tasksChatPlugin.middleware).toBeUndefined();
    expect(tasksChatPlugin.agents).toBeUndefined();
    expect(tasksChatPlugin.displayModes).toBeUndefined();
    expect(tasksChatPlugin.sessionState).toBeUndefined();
    expect(tasksChatPlugin.theme).toBeUndefined();
  });

  it("contributes exactly one panel view: the tasks board", () => {
    expect(tasksChatPlugin.panels).toHaveLength(1);
    const [panel] = tasksChatPlugin.panels ?? [];
    expect(panel?.id).toBe(TASKS_PANEL_ID);
    expect(panel?.title).toBe("Tasks");
    // Step 5: the panel renders through createLazyPanel — the manifest no
    // longer statically imports (or re-exports) the panel component.
    expect(typeof panel?.render).toBe("function");
  });

  it("registers under the admin FULL_GRANT and exposes its panel", () => {
    const registry = createChatPluginRegistry();
    registry.register(tasksChatPlugin, FULL_GRANT);
    expect(registry.pluginIds()).toContain(TASKS_PLUGIN_ID);
    expect(registry.panels().map((p) => p.id)).toEqual([TASKS_PANEL_ID]);
  });

  it("is refused by a surface whose grant lacks the panels capability", () => {
    const registry = createChatPluginRegistry();
    expect(() => registry.register(tasksChatPlugin, ["theme"])).toThrow(
      ChatPluginRegistrationError,
    );
  });
});
