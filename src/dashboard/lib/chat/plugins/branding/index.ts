/**
 * @fileType module
 * @domain chat-plugin-branding
 * @pattern plugin-manifest
 * @ai-summary Branding chat plugin (Step 6, M6). A FACTORY rather than a
 *   static manifest: each client brand (lib/client-brand.ts) produces its
 *   own plugin instance whose theme contribution (name, accent, locale,
 *   optional welcome text) flows through `registry.theme()`. The plugin
 *   declares only the "theme" capability, so it composes under
 *   ClientChatSurface's minimal grant. Brand config is in-repo TS data —
 *   compile-time surface, no zod boundary (plan M5.4; the zod trigger is
 *   consumer-repo-loaded brands, which do not exist yet).
 */
import type { ClientBrand } from "../../../client-brand";
import type { ChatPlugin } from "../../platform";

export const BRANDING_PLUGIN_ID = "branding";

/**
 * Build the branding plugin for one client brand. Theme fields mirror the
 * brand config; `welcomeText` is contributed only when the brand defines it
 * (the merged theme must not carry an `undefined` override — later plugins
 * win per field in `registry.theme()`).
 */
export function createBrandingPlugin(brand: ClientBrand): ChatPlugin {
  return {
    id: BRANDING_PLUGIN_ID,
    capabilities: ["theme"],
    theme: {
      name: brand.name,
      accent: brand.accent,
      locale: brand.locale,
      ...(brand.welcomeText !== undefined
        ? { welcomeText: brand.welcomeText }
        : {}),
    },
  };
}
