/**
 * @fileType component
 * @domain preview
 * @pattern preview-pane
 * @ai-summary The reusable live-preview pane — toolbar (env slot + Web/Admin
 *   views + device sizes + element inspector + refresh + open-in-tab) over an
 *   iframe, plus loading / empty states. Extracted from VibePage so the Vibe
 *   page AND the standalone `/preview` workspace render the identical preview
 *   with all its features. Host owns the base URL source (a PR's deploy in Vibe,
 *   a chosen environment on /preview) and the surrounding <section>; this is
 *   presentation + local toolbar state only.
 */
"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
} from "lucide-react";

import { cn, getPreviewBypassUrl } from "../utils";
import { PreviewInspector } from "../picker/PreviewInspector";
import { PreviewViewsBar } from "./PreviewViewsBar";
import {
  DEFAULT_PREVIEW_VIEWS,
  joinPreviewUrl,
  readPreviewViews,
  type PreviewView,
} from "../preview-views";
import {
  PreviewIframe,
  DEVICE_WIDTHS,
  type PreviewDevice,
} from "./PreviewIframe";
import type {
  ComposerChip,
  AttachmentInjection,
} from "../picker/PreviewInspector";

interface PreviewPaneProps {
  /** Resolved base URL for the active preview, or null when there's nothing to show. */
  baseUrl: string | null;
  /** True while the host is still resolving a URL (e.g. a PR build in flight). */
  isResolving: boolean;
  owner: string;
  repo: string;
  /** Route a picked element / console snapshot to the chat composer. */
  onComposerInjection: (chip: ComposerChip | null) => void;
  /** Route a preview screenshot to the chat composer's attachments. */
  onAttachmentInjection: (att: AttachmentInjection | null) => void;
  /** Slot rendered at the far left of the toolbar (e.g. the environment switcher). */
  leadingToolbar?: ReactNode;
  /** Static file environments should load exact URL, not append Web/Admin. */
  hideViewSwitcher?: boolean;
  /** Override iframe sandbox. Pass null to omit it for native file viewers. */
  iframeSandbox?: string | null;
  /** Shown in the pane when there's no baseUrl and nothing is resolving. */
  emptyState?: ReactNode;
}

export function PreviewPane({
  baseUrl,
  isResolving,
  owner,
  repo,
  onComposerInjection,
  onAttachmentInjection,
  leadingToolbar,
  hideViewSwitcher = false,
  iframeSandbox,
  emptyState,
}: PreviewPaneProps) {
  // The preview area element — the inspector crops screenshots to it.
  const previewRef = useRef<HTMLDivElement>(null);
  // Bump to force an iframe remount on Refresh.
  const [iframeKey, setIframeKey] = useState(0);

  // User-managed views (Web / Admin / custom) — per-repo localStorage.
  const initialViews =
    owner && repo ? readPreviewViews(owner, repo) : DEFAULT_PREVIEW_VIEWS;
  const [selectedView, setSelectedView] = useState<PreviewView>(
    initialViews[0] ?? DEFAULT_PREVIEW_VIEWS[0]!,
  );
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");

  // Compose the iframe URL from the active view's path (Web → /, Admin →
  // /admin, or whatever the user added) under the active base URL.
  const previewUrl = useMemo(() => {
    if (!baseUrl) return null;
    if (hideViewSwitcher) return baseUrl;
    return joinPreviewUrl(baseUrl, selectedView.path);
  }, [baseUrl, hideViewSwitcher, selectedView.path]);
  const bypassedUrl = useMemo(
    () => getPreviewBypassUrl(previewUrl),
    [previewUrl],
  );

  return (
    <>
      {/* Preview toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-3 min-w-0">
          {leadingToolbar}
          {baseUrl && !hideViewSwitcher && (
            <PreviewViewsBar
              owner={owner}
              repo={repo}
              selectedId={selectedView.id}
              onSelect={setSelectedView}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <>
              <div className="flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-800/50 p-0.5">
                {(
                  [
                    { id: "mobile", icon: Smartphone, label: "Mobile" },
                    { id: "tablet", icon: Tablet, label: "Tablet" },
                    { id: "desktop", icon: Monitor, label: "Desktop" },
                  ] as const
                ).map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreviewDevice(id)}
                    title={label}
                    aria-label={`${label} viewport`}
                    aria-pressed={previewDevice === id}
                    className={cn(
                      "inline-flex items-center justify-center rounded p-1.5 transition-colors",
                      previewDevice === id
                        ? "bg-zinc-700 text-white"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-700/50",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <PreviewInspector
                previewRef={previewRef}
                onContext={onComposerInjection}
                onAttachment={onAttachmentInjection}
                owner={owner}
                repo={repo}
              />
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                title="Refresh preview"
                aria-label="Refresh preview"
                className="inline-flex items-center text-xs font-medium p-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <a
                href={bypassedUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                title="Open preview in new tab"
                aria-label="Open preview in new tab"
                className="inline-flex items-center text-xs font-medium p-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* Iframe / empty states */}
      <div
        ref={previewRef}
        className={cn(
          "flex-1 min-h-0",
          previewUrl ? "bg-white" : "bg-zinc-950",
        )}
      >
        {previewUrl ? (
          <PreviewIframe
            src={bypassedUrl ?? undefined}
            title="Preview deployment"
            reloadKey={`${previewUrl}-${iframeKey}`}
            maxWidthPx={DEVICE_WIDTHS[previewDevice]}
            sandbox={iframeSandbox}
          />
        ) : isResolving ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            <p className="text-sm text-zinc-300">Loading preview…</p>
            <p className="text-xs text-zinc-500 max-w-md">
              Fetching this preview. It&apos;ll appear here as soon as the build
              is ready.
            </p>
          </div>
        ) : (
          (emptyState ?? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-sm text-zinc-300">No preview to show</p>
            </div>
          ))
        )}
      </div>
    </>
  );
}
