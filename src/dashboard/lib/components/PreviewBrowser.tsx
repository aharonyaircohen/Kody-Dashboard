/**
 * @fileType component
 * @domain preview
 * @pattern preview-browser
 * @ai-summary Browser-like preview shell shared by Views, Vibe, and task PR
 * previews. Owns URL history, address bar, viewport switching, inspector
 * controls, iframe refresh, and loading/empty states.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
} from "lucide-react";

import { PreviewInspector } from "../picker/PreviewInspector";
import type {
  AttachmentInjection,
  ComposerChip,
} from "../picker/PreviewInspector";
import { PICKER_EXT_SOURCE, type PickerExtMessage } from "../picker/protocol";
import { useElementPicker } from "../picker/useElementPicker";
import { cn, getPreviewBypassUrl } from "../utils";
import {
  DEVICE_WIDTHS,
  PreviewIframe,
  type PreviewDevice,
} from "./PreviewIframe";

export interface PreviewBrowserProps {
  /** Resolved base URL for the active preview, or null when nothing can show. */
  baseUrl: string | null;
  /** True while the host is still resolving a preview URL. */
  isResolving: boolean;
  owner: string;
  repo: string;
  onComposerInjection: (chip: ComposerChip | null) => void;
  onAttachmentInjection: (att: AttachmentInjection | null) => void;
  /** Slot rendered at the left edge of toolbar/browser chrome. */
  leadingToolbar?: ReactNode;
  /** Show back/forward/address browser chrome. */
  showBrowserChrome?: boolean;
  /** Save the current browser URL as a named environment. */
  onSaveCurrentUrl?: (url: string) => void | Promise<void>;
  isSavingCurrentUrl?: boolean;
  /** Called before each iframe load, including reloads. */
  onBeforePreviewLoad?: () => void | Promise<void>;
  /** Override iframe sandbox. Pass null to omit it for native file viewers. */
  iframeSandbox?: string | null;
  /** External key that forces the iframe to reload when it changes. */
  reloadKey?: string | number;
  iframeTitle?: string;
  loadingTitle?: ReactNode;
  loadingDescription?: ReactNode;
  /** Shown when there is no baseUrl and nothing is resolving. */
  emptyState?: ReactNode;
}

interface BrowserHistoryState {
  entries: string[];
  index: number;
}

const PREVIEW_DEVICE_OPTIONS = [
  { id: "mobile", icon: Smartphone, label: "Mobile" },
  { id: "tablet", icon: Tablet, label: "Tablet" },
  { id: "desktop", icon: Monitor, label: "Desktop" },
] as const;

function toBrowserAddress(url: string | null): string {
  if (!url) return "";
  if (typeof window === "undefined") return url;

  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function pushBrowserHistory(
  state: BrowserHistoryState,
  nextUrl: string,
): BrowserHistoryState {
  if (state.entries[state.index] === nextUrl) return state;

  const currentEntries =
    state.index >= 0 ? state.entries.slice(0, state.index + 1) : [];
  const entries = [...currentEntries, nextUrl];
  return { entries, index: entries.length - 1 };
}

function rebasePreviewUrl(
  currentUrl: string,
  fromBaseUrl: string | null,
  toBaseUrl: string,
): string {
  try {
    const current = new URL(currentUrl, window.location.origin);
    const nextBase = new URL(toBaseUrl, window.location.origin);

    if (!fromBaseUrl) {
      nextBase.pathname = current.pathname;
      nextBase.search = current.search;
      nextBase.hash = current.hash;
      return nextBase.toString();
    }

    const fromBase = new URL(fromBaseUrl, window.location.origin);
    const fromPath = fromBase.pathname.replace(/\/+$/, "");
    const nextPath = nextBase.pathname.replace(/\/+$/, "");
    const currentPath = current.pathname;
    const isUnderPreviousBase =
      current.origin === fromBase.origin &&
      (currentPath === fromPath || currentPath.startsWith(`${fromPath}/`));

    if (isUnderPreviousBase) {
      const suffix = currentPath.slice(fromPath.length);
      nextBase.pathname = `${nextPath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    } else {
      nextBase.pathname = currentPath;
    }

    nextBase.search = current.search;
    nextBase.hash = current.hash;
    return nextBase.toString();
  } catch {
    return toBaseUrl;
  }
}

export function PreviewBrowser({
  baseUrl,
  isResolving,
  owner,
  repo,
  onComposerInjection,
  onAttachmentInjection,
  leadingToolbar,
  showBrowserChrome = false,
  onSaveCurrentUrl,
  isSavingCurrentUrl = false,
  onBeforePreviewLoad,
  iframeSandbox,
  reloadKey = "",
  iframeTitle = "Preview deployment",
  loadingTitle = "Loading preview...",
  loadingDescription = "Fetching preview. It'll appear here as soon as the build is ready.",
  emptyState,
}: PreviewBrowserProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const previousBaseUrlRef = useRef<string | null>(null);
  const [browserHistory, setBrowserHistory] = useState<BrowserHistoryState>({
    entries: [],
    index: -1,
  });

  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const viewportMenuRef = useRef<HTMLDivElement>(null);
  const [viewportMenuOpen, setViewportMenuOpen] = useState(false);
  const browserInputFocusedRef = useRef(false);
  const activePreviewUrlRef = useRef<string | null>(null);
  const pageProbe = useElementPicker({ onSelect: () => {} });
  const { available: pageProbeAvailable, collectPage: collectPreviewPage } =
    pageProbe;

  const previewUrl = useMemo(() => baseUrl, [baseUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setBrowserHistory({ entries: [], index: -1 });
      previousBaseUrlRef.current = baseUrl;
      return;
    }

    const previousBaseUrl = previousBaseUrlRef.current;
    setBrowserHistory((state) => {
      const activeUrl = state.entries[state.index];
      const nextUrl =
        showBrowserChrome && activeUrl && previousBaseUrl !== baseUrl
          ? rebasePreviewUrl(activeUrl, previousBaseUrl, baseUrl ?? previewUrl)
          : previewUrl;

      return pushBrowserHistory(state, nextUrl);
    });
    previousBaseUrlRef.current = baseUrl;
  }, [baseUrl, previewUrl, showBrowserChrome]);

  const activePreviewUrl =
    browserHistory.entries[browserHistory.index] ?? previewUrl;
  activePreviewUrlRef.current = activePreviewUrl;

  const previewLoadKey = activePreviewUrl
    ? `${activePreviewUrl}-${iframeKey}-${reloadKey}`
    : null;
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);
  const bypassedUrl = useMemo(
    () => getPreviewBypassUrl(activePreviewUrl),
    [activePreviewUrl],
  );
  const [browserUrl, setBrowserUrl] = useState(() =>
    toBrowserAddress(activePreviewUrl),
  );

  const syncBrowserHistoryUrl = useCallback(
    (url: string | null | undefined): void => {
      const nextUrl = toBrowserAddress(url ?? null);
      if (!nextUrl) return;
      setBrowserHistory((state) => pushBrowserHistory(state, nextUrl));
    },
    [],
  );

  useEffect(() => {
    if (browserInputFocusedRef.current) return;
    setBrowserUrl(toBrowserAddress(activePreviewUrl));
  }, [activePreviewUrl]);

  useEffect(() => {
    if (!showBrowserChrome || !activePreviewUrl) return;

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window) return;
      const data = event.data as PickerExtMessage | undefined;
      if (!data || data.source !== PICKER_EXT_SOURCE) return;
      if (data.type !== "page") return;
      syncBrowserHistoryUrl(data.info.url);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activePreviewUrl, showBrowserChrome, syncBrowserHistoryUrl]);

  useEffect(() => {
    if (
      !showBrowserChrome ||
      !activePreviewUrl ||
      !previewLoadKey ||
      loadedPreviewKey !== previewLoadKey ||
      !pageProbeAvailable
    ) {
      return;
    }

    let cancelled = false;
    let busy = false;

    const syncPreviewUrl = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const info = await collectPreviewPage(700);
        if (cancelled || !info?.url) return;
        const nextUrl = toBrowserAddress(info.url);
        if (!nextUrl) return;
        syncBrowserHistoryUrl(nextUrl);
      } finally {
        busy = false;
      }
    };

    void syncPreviewUrl();
    const interval = window.setInterval(syncPreviewUrl, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activePreviewUrl,
    collectPreviewPage,
    loadedPreviewKey,
    pageProbeAvailable,
    previewLoadKey,
    showBrowserChrome,
    syncBrowserHistoryUrl,
  ]);

  useEffect(() => {
    if (!viewportMenuOpen) return;

    const onDocumentClick = (event: MouseEvent): void => {
      if (!viewportMenuRef.current) return;
      if (
        event.target instanceof Node &&
        viewportMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setViewportMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setViewportMenuOpen(false);
    };

    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [viewportMenuOpen]);

  const canGoBack = browserHistory.index > 0;
  const canGoForward =
    browserHistory.index >= 0 &&
    browserHistory.index < browserHistory.entries.length - 1;

  const moveBrowserHistory = (direction: "back" | "forward"): void => {
    setBrowserHistory((state) => {
      const nextIndex =
        direction === "back" ? state.index - 1 : state.index + 1;
      if (nextIndex < 0 || nextIndex >= state.entries.length) return state;
      return { ...state, index: nextIndex };
    });
  };

  const normalizeAddressInput = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).toString();
      if (trimmed.startsWith("/")) {
        return new URL(
          trimmed,
          activePreviewUrl ?? previewUrl ?? window.location.origin,
        ).toString();
      }
      if (
        /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
      ) {
        return new URL(`http://${trimmed}`).toString();
      }
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  };

  const navigateToTypedAddress = (): void => {
    const nextUrl = normalizeAddressInput(browserUrl);
    if (!nextUrl) {
      setBrowserUrl(toBrowserAddress(activePreviewUrlRef.current));
      return;
    }

    activePreviewUrlRef.current = nextUrl;
    setBrowserUrl(toBrowserAddress(nextUrl));
    setBrowserHistory((state) => pushBrowserHistory(state, nextUrl));
  };

  const activePreviewDevice =
    PREVIEW_DEVICE_OPTIONS.find((option) => option.id === previewDevice) ??
    PREVIEW_DEVICE_OPTIONS[2];
  const ActivePreviewDeviceIcon = activePreviewDevice.icon;

  const previewControls = activePreviewUrl ? (
    <>
      <div ref={viewportMenuRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setViewportMenuOpen((open) => !open)}
          title={`Viewport: ${activePreviewDevice.label}`}
          aria-label="Switch preview viewport"
          aria-haspopup="listbox"
          aria-expanded={viewportMenuOpen}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
        >
          <ActivePreviewDeviceIcon className="w-3.5 h-3.5" />
          <ChevronDown className="w-3 h-3" />
        </button>

        {viewportMenuOpen && (
          <div
            role="listbox"
            aria-label="Preview viewport"
            className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            {PREVIEW_DEVICE_OPTIONS.map(({ id, icon: Icon, label }) => {
              const selected = previewDevice === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setPreviewDevice(id);
                    setViewportMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                    selected
                      ? "text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
                  )}
                >
                  <Check
                    className={cn(
                      "w-3 h-3",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <PreviewInspector
        previewRef={previewRef}
        onContext={onComposerInjection}
        onAttachment={onAttachmentInjection}
        owner={owner}
        repo={repo}
      />
    </>
  ) : null;

  return (
    <>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
        <div className="flex flex-1 items-center gap-3 min-w-0">
          {!showBrowserChrome && leadingToolbar}
        </div>

        {showBrowserChrome && activePreviewUrl && (
          <div className="order-last flex w-full min-w-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/70 p-0.5">
            {leadingToolbar && (
              <div className="flex shrink-0 items-center gap-0.5 border-r border-zinc-700/80 pr-1">
                {leadingToolbar}
              </div>
            )}
            <button
              type="button"
              onClick={() => moveBrowserHistory("back")}
              disabled={!canGoBack}
              title={canGoBack ? "Go back" : "No previous page"}
              aria-label="Go back in preview"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded p-1.5 transition-colors",
                canGoBack
                  ? "text-zinc-400 hover:bg-zinc-700/60 hover:text-white"
                  : "cursor-not-allowed text-zinc-600",
              )}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveBrowserHistory("forward")}
              disabled={!canGoForward}
              title={canGoForward ? "Go forward" : "No next page"}
              aria-label="Go forward in preview"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded p-1.5 transition-colors",
                canGoForward
                  ? "text-zinc-400 hover:bg-zinc-700/60 hover:text-white"
                  : "cursor-not-allowed text-zinc-600",
              )}
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <input
              aria-label="Current preview URL"
              title={browserUrl}
              value={browserUrl}
              onFocus={() => {
                browserInputFocusedRef.current = true;
              }}
              onBlur={() => {
                browserInputFocusedRef.current = false;
                setBrowserUrl(toBrowserAddress(activePreviewUrlRef.current));
              }}
              onChange={(event) => setBrowserUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  navigateToTypedAddress();
                  event.currentTarget.blur();
                  return;
                }
                if (event.key === "Escape") {
                  event.currentTarget.blur();
                  setBrowserUrl(toBrowserAddress(activePreviewUrl));
                }
              }}
              className="h-7 min-w-0 flex-1 rounded border-0 bg-zinc-950/80 px-2 font-mono text-[11px] text-zinc-300 outline-none ring-0 selection:bg-sky-500/30"
            />
            {onSaveCurrentUrl && (
              <button
                type="button"
                onClick={() => {
                  if (activePreviewUrl) void onSaveCurrentUrl(activePreviewUrl);
                }}
                disabled={isSavingCurrentUrl}
                title="Save current URL as environment"
                aria-label="Save current URL as environment"
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded p-1.5 transition-colors",
                  isSavingCurrentUrl
                    ? "cursor-wait text-zinc-600"
                    : "text-zinc-400 hover:bg-zinc-700/60 hover:text-white",
                )}
              >
                {isSavingCurrentUrl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Bookmark className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIframeKey((key) => key + 1)}
              title="Refresh preview"
              aria-label="Refresh preview"
              className="inline-flex shrink-0 items-center justify-center rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {previewControls && (
              <div className="flex shrink-0 items-center gap-2 border-l border-zinc-700/80 pl-1.5">
                {previewControls}
              </div>
            )}
          </div>
        )}

        {!showBrowserChrome && previewControls && (
          <div className="flex items-center gap-2">{previewControls}</div>
        )}
      </div>

      <div
        ref={previewRef}
        className={cn(
          "flex-1 min-h-0",
          activePreviewUrl ? "bg-white" : "bg-zinc-950",
        )}
      >
        {activePreviewUrl ? (
          <PreviewIframe
            src={bypassedUrl ?? undefined}
            title={iframeTitle}
            reloadKey={previewLoadKey ?? ""}
            onLoad={() => setLoadedPreviewKey(previewLoadKey)}
            onBeforeLoad={onBeforePreviewLoad}
            maxWidthPx={DEVICE_WIDTHS[previewDevice]}
            sandbox={iframeSandbox}
          />
        ) : isResolving ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            <p className="text-sm text-zinc-300">{loadingTitle}</p>
            {loadingDescription && (
              <p className="text-xs text-zinc-500 max-w-md">
                {loadingDescription}
              </p>
            )}
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
