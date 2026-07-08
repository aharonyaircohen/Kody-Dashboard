/**
 * @fileType component
 * @domain chat-platform
 * @pattern lazy-panel-factory
 * @ai-summary Bundle-split helper for page-plugin panels (phase 2 step 5).
 *   Page-plugin manifests stay tiny leaves (id/title only) by wrapping
 *   their panel component in React.lazy via this factory — the panel
 *   module (and the page component tree it renders) loads on FIRST OPEN,
 *   not when ChatRailShell registers the plugin. Same precedent as the
 *   terminal plugin's React.lazy surfaces: any static path from a manifest
 *   to a heavy component puts it in the shared sync chunk every surface
 *   loads. Suspense fallback is null — the panel area simply stays empty
 *   for the (dev-only visible) beat while the chunk resolves.
 */
"use client";

import {
  Suspense,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

import type { ChatPanelViewProps } from "./types";

type PanelModule = { default: ComponentType<ChatPanelViewProps> };

/**
 * Wrap a dynamically imported panel component so the manifest can
 * reference it without statically importing the panel module.
 */
export function createLazyPanel(
  id: string,
  load: () => Promise<PanelModule>,
): ComponentType<ChatPanelViewProps> {
  const LazyView: LazyExoticComponent<ComponentType<ChatPanelViewProps>> =
    lazy(load);
  function LazyPanel(props: ChatPanelViewProps) {
    return (
      <Suspense fallback={null}>
        <LazyView {...props} />
      </Suspense>
    );
  }
  LazyPanel.displayName = `LazyPanel(${id})`;
  return LazyPanel;
}
