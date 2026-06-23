/**
 * @fileType component
 * @domain kody
 * @pattern preview-iframe
 * @ai-summary Preview deployment iframe with a loading overlay. Covers the
 * blank white gap while the embedded site itself loads (after we already have
 * the URL), and re-shows on refresh or when the URL changes. Shared by
 * PreviewModal and VibePage so both panes behave identically.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export type PreviewDevice = "mobile" | "tablet" | "desktop";

// Viewport widths (px) used to simulate a device in the preview iframe.
// `desktop` is undefined = fill the pane.
export const DEVICE_WIDTHS: Record<PreviewDevice, number | undefined> = {
  mobile: 390,
  tablet: 820,
  desktop: undefined,
};

const DEFAULT_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups";

interface PreviewIframeProps {
  src: string | undefined;
  title: string;
  /** Bump/change to force a reload and re-show the spinner (refresh button). */
  reloadKey: string | number;
  onLoad?: () => void;
  /**
   * Optional viewport width (px) to simulate a device. When set, the iframe is
   * clamped to this width and centered so you can preview the responsive
   * layout; unset = fill the pane (desktop).
   */
  maxWidthPx?: number;
  sandbox?: string | null;
}

export function PreviewIframe({
  src,
  title,
  reloadKey,
  onLoad,
  maxWidthPx,
  sandbox = DEFAULT_IFRAME_SANDBOX,
}: PreviewIframeProps) {
  const [loaded, setLoaded] = useState(false);

  // Re-show the spinner whenever the embedded URL or the reload key changes
  // (URL resolves, web/admin toggle, or a manual refresh).
  useEffect(() => {
    setLoaded(false);
  }, [src, reloadKey]);

  const sandboxProps =
    sandbox === null ? {} : ({ sandbox } satisfies { sandbox: string });

  return (
    <div className="relative w-full h-full flex justify-center bg-zinc-900">
      <iframe
        key={reloadKey}
        src={src}
        title={title}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        style={maxWidthPx ? { maxWidth: `${maxWidthPx}px` } : undefined}
        className="w-full h-full border-0 bg-white"
        {...sandboxProps}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-300">Loading preview…</p>
          </div>
        </div>
      )}
    </div>
  );
}
