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

interface PreviewIframeProps {
  src: string | undefined;
  title: string;
  /** Bump/change to force a reload and re-show the spinner (refresh button). */
  reloadKey: string | number;
}

export function PreviewIframe({ src, title, reloadKey }: PreviewIframeProps) {
  const [loaded, setLoaded] = useState(false);

  // Re-show the spinner whenever the embedded URL or the reload key changes
  // (URL resolves, web/admin toggle, or a manual refresh).
  useEffect(() => {
    setLoaded(false);
  }, [src, reloadKey]);

  return (
    <div className="relative w-full h-full">
      <iframe
        key={reloadKey}
        src={src}
        title={title}
        onLoad={() => setLoaded(true)}
        className="w-full h-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
