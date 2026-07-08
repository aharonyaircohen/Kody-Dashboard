/**
 * @fileType component
 * @domain client-chat
 * @pattern route-shell
 * @ai-summary Public/client route shell: ChatSurface composition (Step 6).
 *   The brand becomes a branding plugin (theme capability); the surface
 *   registers ONLY branding + commands under a minimal grant, so the
 *   /client chunk never imports terminal/vibe/goals plugin code (M6
 *   per-surface imports). Grants gate client-side composition only — not a
 *   security boundary (plan M6). KodyChat props stay the frozen trio
 *   (presentation / hideTerminalMode / railFullscreen).
 */
"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";

import type { ClientBrand } from "@dashboard/lib/client-brand";
import { directionForLocale } from "@dashboard/lib/chat/platform/i18n";
import type { ChatCapabilityGrant } from "@dashboard/lib/chat/platform";
import { createBrandingPlugin } from "@dashboard/lib/chat/plugins/branding";
import { commandsChatPlugin } from "@dashboard/lib/chat/plugins/commands";
import { getClientSurfaceCatalog } from "@dashboard/lib/client-chat-strings";
import { KodyChat } from "./KodyChat";

// Minimal grant for the client surface: "theme" for the branding plugin,
// "middleware" + "host-effects" for the commands plugin (slash expansion ran
// on every surface pre-platform, so /client keeps it). Nothing else — no
// slots, agents, display modes, or session state.
const CLIENT_CHAT_GRANT: ChatCapabilityGrant = [
  "theme",
  "middleware",
  "host-effects",
];

export function ClientChatSurface({ brand }: { brand: ClientBrand }) {
  // The branding plugin is the single source for what this shell displays:
  // the header reads the SAME theme contribution the registry merges via
  // `registry.theme()` inside the KodyChat mount.
  const brandingPlugin = useMemo(() => createBrandingPlugin(brand), [brand]);
  const plugins = useMemo(
    () => [{ plugin: brandingPlugin }, { plugin: commandsChatPlugin }],
    [brandingPlugin],
  );
  const theme = brandingPlugin.theme ?? {};
  const locale = theme.locale ?? "en";
  const catalog = getClientSurfaceCatalog(locale);

  return (
    <main
      data-testid="client-chat-surface"
      // Surface-root direction only — per-message bubbles keep their own
      // explicit `dir` (getMessageDirection in chat/surface/MessageList.tsx).
      dir={directionForLocale(locale)}
      className="flex h-dvh min-h-dvh flex-col bg-background text-foreground"
    >
      <header className="shrink-0 border-b border-border bg-background px-4 py-3">
        <div className="flex w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              data-testid="client-brand-accent"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white shadow-sm"
              style={{ backgroundColor: theme.accent }}
              aria-hidden="true"
            >
              <Zap className="h-4 w-4" />
            </span>
            <span
              data-testid="client-brand-name"
              className="truncate text-base font-semibold"
            >
              {theme.name}
            </span>
          </div>
        </div>
      </header>

      <div
        aria-label={catalog.t("chat.client.chatRegionLabel")}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <KodyChat
          presentation="standalone"
          hideTerminalMode
          railFullscreen
          plugins={plugins}
          capabilityGrant={CLIENT_CHAT_GRANT}
        />
      </div>
    </main>
  );
}
