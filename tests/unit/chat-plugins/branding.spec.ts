/**
 * @fileoverview Unit tests for the branding chat plugin factory (Step 6):
 * theme contribution from the brand config, locale passthrough, optional
 * welcomeText handling, and composition through the registry under the
 * client surface's minimal "theme" grant.
 *
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  BRANDING_PLUGIN_ID,
  createBrandingPlugin,
} from "@dashboard/lib/chat/plugins/branding";
import { getClientBrand } from "@dashboard/lib/client-brand";
import {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
} from "@dashboard/lib/chat/platform/registry";

describe("branding chat plugin factory", () => {
  it("declares only the theme capability", () => {
    const plugin = createBrandingPlugin(getClientBrand("kody"));
    expect(plugin.id).toBe(BRANDING_PLUGIN_ID);
    expect(plugin.capabilities).toEqual(["theme"]);
    // Theme-only: no slots, middleware, agents, display modes, or state.
    expect(plugin.slots).toBeUndefined();
    expect(plugin.middleware).toBeUndefined();
    expect(plugin.agents).toBeUndefined();
    expect(plugin.displayModes).toBeUndefined();
    expect(plugin.sessionState).toBeUndefined();
  });

  it("contributes name, accent, and locale from the brand config", () => {
    const plugin = createBrandingPlugin({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      locale: "en",
    });
    expect(plugin.theme).toEqual({
      name: "Acme",
      accent: "#7c3aed",
      locale: "en",
    });
  });

  it("passes a non-default locale through untouched (RTL brand)", () => {
    const brand = getClientBrand("kody-he");
    const plugin = createBrandingPlugin(brand);
    expect(plugin.theme?.locale).toBe("he");
    expect(plugin.theme?.name).toBe("Kody");
  });

  it("contributes welcomeText only when the brand defines it", () => {
    const without = createBrandingPlugin({
      slug: "kody",
      name: "Kody",
      accent: "#0f766e",
      locale: "en",
    });
    // Absent, not `undefined` — an undefined field would still override an
    // earlier plugin's welcomeText in the registry's per-field theme merge.
    expect("welcomeText" in (without.theme ?? {})).toBe(false);

    const withText = createBrandingPlugin({
      slug: "kody",
      name: "Kody",
      accent: "#0f766e",
      locale: "en",
      welcomeText: "Hi! Ask me anything about your project.",
    });
    expect(withText.theme?.welcomeText).toBe(
      "Hi! Ask me anything about your project.",
    );
  });

  it("registers under the minimal theme grant and flows through registry.theme()", () => {
    const registry = createChatPluginRegistry();
    registry.register(createBrandingPlugin(getClientBrand("acme")), [
      "theme",
    ]);
    expect(registry.pluginIds()).toEqual([BRANDING_PLUGIN_ID]);
    expect(registry.theme()).toEqual({
      name: "Acme",
      accent: "#7c3aed",
      locale: "en",
    });
  });

  it("is refused by a grant without the theme capability", () => {
    const registry = createChatPluginRegistry();
    expect(() =>
      registry.register(createBrandingPlugin(getClientBrand("kody")), [
        "middleware",
        "host-effects",
      ]),
    ).toThrow(ChatPluginRegistrationError);
  });
});
