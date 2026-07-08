/**
 * @fileoverview Unit tests for the phase 2 step 4 page-plugin manifests —
 * one parametrized suite covering every admin page migrated via the
 * tasks-pilot recipe. Each manifest must be panels-only (honest boundary:
 * no server-tool half), contribute exactly one panel whose id/title/render
 * match the recipe, register under the admin FULL_GRANT, and be refused by
 * a grant lacking "panels".
 *
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import type { ChatPlugin } from "@dashboard/lib/chat/platform";
import { FULL_GRANT } from "@dashboard/lib/chat/platform/capabilities";
import {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
} from "@dashboard/lib/chat/platform/registry";

import { activityChatPlugin } from "@dashboard/lib/chat/plugins/activity";
import { agencyRunsChatPlugin } from "@dashboard/lib/chat/plugins/agency-runs";
import { agentGoalsChatPlugin } from "@dashboard/lib/chat/plugins/agent-goals";
import { agentLoopsChatPlugin } from "@dashboard/lib/chat/plugins/agent-loops";
import { agentsChatPlugin } from "@dashboard/lib/chat/plugins/agents";
import { capabilitiesChatPlugin } from "@dashboard/lib/chat/plugins/capabilities";
import { changelogChatPlugin } from "@dashboard/lib/chat/plugins/changelog";
import { commandsPageChatPlugin } from "@dashboard/lib/chat/plugins/commands-page";
import { companyChatPlugin } from "@dashboard/lib/chat/plugins/company";
import { companyIntentsChatPlugin } from "@dashboard/lib/chat/plugins/company-intents";
import { configChatPlugin } from "@dashboard/lib/chat/plugins/config";
import { contextChatPlugin } from "@dashboard/lib/chat/plugins/context";
import { docsChatPlugin } from "@dashboard/lib/chat/plugins/docs";
import { filesChatPlugin } from "@dashboard/lib/chat/plugins/files";
import { inboxChatPlugin } from "@dashboard/lib/chat/plugins/inbox";
import { instructionsChatPlugin } from "@dashboard/lib/chat/plugins/instructions";
import { memoryChatPlugin } from "@dashboard/lib/chat/plugins/memory";
import { messagesChatPlugin } from "@dashboard/lib/chat/plugins/messages";
import { modelsChatPlugin } from "@dashboard/lib/chat/plugins/models";
import { notificationsChatPlugin } from "@dashboard/lib/chat/plugins/notifications";
import { previewChatPlugin } from "@dashboard/lib/chat/plugins/preview";
import { reportsChatPlugin } from "@dashboard/lib/chat/plugins/reports";
import { secretsChatPlugin } from "@dashboard/lib/chat/plugins/secrets";
import { settingsChatPlugin } from "@dashboard/lib/chat/plugins/settings";
import { storeCatalogChatPlugin } from "@dashboard/lib/chat/plugins/store-catalog";
import { todosChatPlugin } from "@dashboard/lib/chat/plugins/todos";
import { variablesChatPlugin } from "@dashboard/lib/chat/plugins/variables";
import { workflowsChatPlugin } from "@dashboard/lib/chat/plugins/workflows";

interface PagePluginCase {
  slug: string;
  title: string;
  plugin: ChatPlugin;
}

const PAGE_PLUGINS: readonly PagePluginCase[] = [
  { slug: "activity", title: "Activity", plugin: activityChatPlugin },
  { slug: "agency-runs", title: "Agency Runs", plugin: agencyRunsChatPlugin },
  { slug: "agent-goals", title: "Goals", plugin: agentGoalsChatPlugin },
  { slug: "agent-loops", title: "Loops", plugin: agentLoopsChatPlugin },
  { slug: "agents", title: "Agent", plugin: agentsChatPlugin },
  { slug: "capabilities", title: "Capabilities", plugin: capabilitiesChatPlugin },
  { slug: "changelog", title: "Changelog", plugin: changelogChatPlugin },
  { slug: "commands-page", title: "Commands", plugin: commandsPageChatPlugin },
  { slug: "company", title: "AI Agency", plugin: companyChatPlugin },
  { slug: "company-intents", title: "Intents", plugin: companyIntentsChatPlugin },
  { slug: "config", title: "Config", plugin: configChatPlugin },
  { slug: "context", title: "Context", plugin: contextChatPlugin },
  { slug: "docs", title: "Docs", plugin: docsChatPlugin },
  { slug: "files", title: "Files", plugin: filesChatPlugin },
  { slug: "inbox", title: "Inbox", plugin: inboxChatPlugin },
  { slug: "instructions", title: "Instructions", plugin: instructionsChatPlugin },
  { slug: "memory", title: "Memory", plugin: memoryChatPlugin },
  { slug: "messages", title: "Messages", plugin: messagesChatPlugin },
  { slug: "models", title: "Chat Models", plugin: modelsChatPlugin },
  { slug: "notifications", title: "Notifications", plugin: notificationsChatPlugin },
  { slug: "preview", title: "Views", plugin: previewChatPlugin },
  { slug: "reports", title: "Reports", plugin: reportsChatPlugin },
  { slug: "secrets", title: "Secrets", plugin: secretsChatPlugin },
  { slug: "settings", title: "Settings", plugin: settingsChatPlugin },
  { slug: "store-catalog", title: "Store Catalog", plugin: storeCatalogChatPlugin },
  { slug: "todos", title: "Todos", plugin: todosChatPlugin },
  { slug: "variables", title: "Variables", plugin: variablesChatPlugin },
  { slug: "workflows", title: "Workflows", plugin: workflowsChatPlugin },
];

describe.each(PAGE_PLUGINS)(
  "page-plugin manifest: $slug",
  ({ slug, title, plugin }) => {
    it("declares only the panels capability (no server-tool half)", () => {
      expect(plugin.id).toBe(slug);
      expect(plugin.capabilities).toEqual(["panels"]);
      expect(plugin.capabilities).not.toContain("tools");
      expect(plugin.slots).toBeUndefined();
      expect(plugin.middleware).toBeUndefined();
      expect(plugin.agents).toBeUndefined();
      expect(plugin.displayModes).toBeUndefined();
      expect(plugin.sessionState).toBeUndefined();
      expect(plugin.theme).toBeUndefined();
    });

    it("contributes exactly one panel with the recipe id/title", () => {
      expect(plugin.panels).toHaveLength(1);
      const [panel] = plugin.panels ?? [];
      expect(panel?.id).toBe(slug);
      expect(panel?.title).toBe(title);
      expect(typeof panel?.render).toBe("function");
    });

    it("registers under the admin FULL_GRANT and exposes its panel", () => {
      const registry = createChatPluginRegistry();
      registry.register(plugin, FULL_GRANT);
      expect(registry.pluginIds()).toContain(slug);
      expect(registry.panels().map((p) => p.id)).toEqual([slug]);
    });

    it("is refused by a surface whose grant lacks the panels capability", () => {
      const registry = createChatPluginRegistry();
      expect(() => registry.register(plugin, ["theme"])).toThrow(
        ChatPluginRegistrationError,
      );
    });
  },
);

describe("page-plugin coverage", () => {
  it("all plugin ids are unique", () => {
    const ids = PAGE_PLUGINS.map((c) => c.plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
