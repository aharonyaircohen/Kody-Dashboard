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
  ExternalLink,
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
import {
  carryPreviewAuthParams,
  hasPreviewAuthParams,
  rebasePreviewAuthUrl,
  stripPreviewAuthParams,
} from "../preview-auth-url";
import { shouldSyncPreviewBrowserUrl } from "../preview-browser-url";
import { PICKER_EXT_SOURCE, type PickerExtMessage } from "../picker/protocol";
import { useElementPicker } from "../picker/useElementPicker";
import { cn, getPreviewBypassUrl } from "../utils";
import {
  DEVICE_WIDTHS,
  PreviewIframe,
  type PreviewDevice,
} from "./PreviewIframe";
import { PreviewFloatingMenu } from "./PreviewFloatingMenu";

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
  /** Mint a fresh signed preview URL before a manual iframe refresh. */
  onRefreshPreviewUrl?: (
    currentUrl: string | null,
  ) => string | null | Promise<string | null>;
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

function toAbsolutePreviewUrl(url: string | null): string {
  if (!url) return "";
  if (typeof window === "undefined") return url;

  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function toBrowserAddress(url: string | null): string {
  const absolute = toAbsolutePreviewUrl(url);
  if (!absolute) return "";
  if (typeof window === "undefined") return absolute;
  return stripPreviewAuthParams(absolute, window.location.origin) ?? absolute;
}

function sameBrowserAddress(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right || typeof window === "undefined") return left === right;
  return (
    stripPreviewAuthParams(left, window.location.origin) ===
    stripPreviewAuthParams(right, window.location.origin)
  );
}

function pushBrowserHistory(
  state: BrowserHistoryState,
  nextUrl: string,
): BrowserHistoryState {
  const currentUrl = state.entries[state.index];
  if (currentUrl === nextUrl) return state;
  if (sameBrowserAddress(currentUrl, nextUrl)) {
    return state;
  }

  const currentEntries =
    state.index >= 0 ? state.entries.slice(0, state.index + 1) : [];
  const entries = [...currentEntries, nextUrl];
  return { entries, index: entries.length - 1 };
}

function replaceCurrentBrowserHistory(
  state: BrowserHistoryState,
  nextUrl: string,
): BrowserHistoryState {
  if (state.index < 0) return pushBrowserHistory(state, nextUrl);
  const entries = [...state.entries];
  entries[state.index] = nextUrl;
  return { entries, index: state.index };
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
  onRefreshPreviewUrl,
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
  const [iframeSourceUrl, setIframeSourceUrl] = useState<string | null>(null);

  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const viewportMenuRef = useRef<HTMLDivElement>(null);
  const [viewportMenuOpen, setViewportMenuOpen] = useState(false);
  const browserInputFocusedRef = useRef(false);
  const activePreviewUrlRef = useRef<string | null>(null);
  const previewAuthSourceUrlRef = useRef<string | null>(null);
  const pageProbe = useElementPicker({ onSelect: () => {} });
  const { available: pageProbeAvailable, collectPage: collectPreviewPage } =
    pageProbe;

  const previewUrl = useMemo(() => baseUrl, [baseUrl]);

  const getPreviewAuthSourceUrl = useCallback((): string | null => {
    if (typeof window === "undefined") {
      return activePreviewUrlRef.current ?? previewUrl;
    }

    const absolutePreviewUrl = toAbsolutePreviewUrl(previewUrl);
    if (
      absolutePreviewUrl &&
      hasPreviewAuthParams(absolutePreviewUrl, window.location.origin)
    ) {
      return absolutePreviewUrl;
    }

    return (
      previewAuthSourceUrlRef.current ??
      activePreviewUrlRef.current ??
      absolutePreviewUrl
    );
  }, [previewUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!previewUrl) {
      previewAuthSourceUrlRef.current = null;
      return;
    }

    const absolutePreviewUrl = toAbsolutePreviewUrl(previewUrl);
    if (hasPreviewAuthParams(absolutePreviewUrl, window.location.origin)) {
      previewAuthSourceUrlRef.current = absolutePreviewUrl;
    }
  }, [previewUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setBrowserHistory({ entries: [], index: -1 });
      setIframeSourceUrl(null);
      previousBaseUrlRef.current = baseUrl;
      return;
    }

    const previousBaseUrl = previousBaseUrlRef.current;
    let nextIframeSourceUrl: string | null = null;
    setBrowserHistory((state) => {
      const activeUrl = state.entries[state.index];
      const nextUrl =
        showBrowserChrome && activeUrl && previousBaseUrl !== baseUrl
          ? rebasePreviewUrl(activeUrl, previousBaseUrl, baseUrl ?? previewUrl)
          : previewUrl;

      nextIframeSourceUrl = nextUrl;
      return pushBrowserHistory(state, nextUrl);
    });
    if (nextIframeSourceUrl) {
      setIframeSourceUrl((current) =>
        sameBrowserAddress(current, nextIframeSourceUrl)
          ? current
          : nextIframeSourceUrl,
      );
    }
    previousBaseUrlRef.current = baseUrl;
  }, [baseUrl, previewUrl, showBrowserChrome]);

  const rawActivePreviewUrl =
    browserHistory.entries[browserHistory.index] ?? previewUrl;
  const activePreviewUrl = useMemo(() => {
    if (!rawActivePreviewUrl || typeof window === "undefined") {
      return rawActivePreviewUrl;
    }

    return (
      carryPreviewAuthParams(
        getPreviewAuthSourceUrl(),
        rawActivePreviewUrl,
        window.location.origin,
      ) ?? rawActivePreviewUrl
    );
  }, [getPreviewAuthSourceUrl, rawActivePreviewUrl]);
  activePreviewUrlRef.current = activePreviewUrl;

  const iframeLoadUrl = iframeSourceUrl ?? previewUrl;
  const previewLoadKey = iframeLoadUrl
    ? `${iframeLoadUrl}-${iframeKey}-${reloadKey}`
    : null;
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);
  const iframeBypassedUrl = useMemo(
    () => getPreviewBypassUrl(iframeLoadUrl),
    [iframeLoadUrl],
  );
  const externalPreviewUrl = useMemo(
    () => getPreviewBypassUrl(activePreviewUrl),
    [activePreviewUrl],
  );
  const [browserUrl, setBrowserUrl] = useState(() =>
    toBrowserAddress(activePreviewUrl),
  );

  const syncBrowserHistoryUrl = useCallback(
    (url: string | null | undefined): void => {
      const nextUrl = toAbsolutePreviewUrl(url ?? null);
      if (!nextUrl) return;
      if (
        typeof window !== "undefined" &&
        !shouldSyncPreviewBrowserUrl(
          nextUrl,
          activePreviewUrlRef.current ?? previewUrl,
          window.location.origin,
        )
      ) {
        return;
      }
      const authedUrl =
        typeof window === "undefined"
          ? nextUrl
          : (carryPreviewAuthParams(
              getPreviewAuthSourceUrl(),
              nextUrl,
              window.location.origin,
            ) ?? nextUrl);
      setBrowserHistory((state) => pushBrowserHistory(state, authedUrl));
    },
    [getPreviewAuthSourceUrl, previewUrl],
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

  const canGoBack = browserHistory.index > 0;
  const canGoForward =
    browserHistory.index >= 0 &&
    browserHistory.index < browserHistory.entries.length - 1;

  const moveBrowserHistory = (direction: "back" | "forward"): void => {
    const nextIndex =
      direction === "back"
        ? browserHistory.index - 1
        : browserHistory.index + 1;
    if (nextIndex < 0 || nextIndex >= browserHistory.entries.length) return;
    const nextUrl = browserHistory.entries[nextIndex] ?? null;
    if (nextUrl) setIframeSourceUrl(nextUrl);
    setBrowserHistory({ ...browserHistory, index: nextIndex });
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

    const authedNextUrl =
      typeof window === "undefined"
        ? nextUrl
        : (carryPreviewAuthParams(
            getPreviewAuthSourceUrl(),
            nextUrl,
            window.location.origin,
          ) ?? nextUrl);
    activePreviewUrlRef.current = authedNextUrl;
    setIframeSourceUrl(authedNextUrl);
    setBrowserUrl(toBrowserAddress(authedNextUrl));
    setBrowserHistory((state) => pushBrowserHistory(state, authedNextUrl));
  };

  const refreshPreview = async (): Promise<void> => {
    const currentUrl = activePreviewUrlRef.current;
    let nextRefreshSourceUrl = currentUrl;
    if (onRefreshPreviewUrl && currentUrl) {
      try {
        const freshPreviewUrl = await onRefreshPreviewUrl(currentUrl);
        const refreshedUrl =
          typeof window === "undefined"
            ? freshPreviewUrl
            : rebasePreviewAuthUrl(
                currentUrl,
                freshPreviewUrl,
                window.location.origin,
              );

        if (refreshedUrl) {
          if (
            typeof window !== "undefined" &&
            hasPreviewAuthParams(refreshedUrl, window.location.origin)
          ) {
            previewAuthSourceUrlRef.current = refreshedUrl;
          }
          activePreviewUrlRef.current = refreshedUrl;
          nextRefreshSourceUrl = refreshedUrl;
          setBrowserUrl(toBrowserAddress(refreshedUrl));
          setBrowserHistory((state) =>
            replaceCurrentBrowserHistory(state, refreshedUrl),
          );
        }
      } catch {
        // Refresh still reloads the current iframe source; auth refresh is best-effort.
      }
    }

    if (nextRefreshSourceUrl) setIframeSourceUrl(nextRefreshSourceUrl);
    setIframeKey((key) => key + 1);
  };

  const activePreviewDevice =
    PREVIEW_DEVICE_OPTIONS.find((option) => option.id === previewDevice) ??
    PREVIEW_DEVICE_OPTIONS[2];
  const ActivePreviewDeviceIcon = activePreviewDevice.icon;
  const closeViewportMenu = useCallback(() => setViewportMenuOpen(false), []);

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
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-3 text-body-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/70 hover:text-white"
        >
          <ActivePreviewDeviceIcon className="h-4 w-4" />
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <PreviewFloatingMenu
          open={viewportMenuOpen}
          anchorRef={viewportMenuRef}
          align="end"
          onClose={closeViewportMenu}
          className="min-w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
        >
          <div role="listbox" aria-label="Preview viewport">
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
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-xs transition-colors",
                    selected
                      ? "text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </PreviewFloatingMenu>
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
      <div className="flex h-[55px] shrink-0 items-center bg-[#15161a] shadow-[inset_0_-1px_0_rgba(255,255,255,0.045)]">
        <div className="flex h-full min-w-0 flex-1 items-center gap-3.5">
          {!showBrowserChrome && leadingToolbar}
        </div>

        {showBrowserChrome && (activePreviewUrl || leadingToolbar) && (
          <div className="flex h-full w-full min-w-0 items-center gap-2 overflow-x-auto px-3">
            {leadingToolbar && (
              <div className="flex h-[34px] shrink-0 items-center gap-1 border-r border-white/[0.08] pr-3">
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
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors",
                canGoBack
                  ? "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                  : "cursor-not-allowed text-zinc-600",
              )}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveBrowserHistory("forward")}
              disabled={!canGoForward}
              title={canGoForward ? "Go forward" : "No next page"}
              aria-label="Go forward in preview"
              className={cn(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors",
                canGoForward
                  ? "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                  : "cursor-not-allowed text-zinc-600",
              )}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
            {onSaveCurrentUrl && activePreviewUrl && (
              <button
                type="button"
                onClick={() => {
                  if (activePreviewUrl)
                    void onSaveCurrentUrl(toBrowserAddress(activePreviewUrl));
                }}
                disabled={isSavingCurrentUrl}
                title="Save current URL as environment"
                aria-label="Save current URL as environment"
                className={cn(
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors",
                  isSavingCurrentUrl
                    ? "cursor-wait text-zinc-600"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {isSavingCurrentUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bookmark className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void refreshPreview();
              }}
              disabled={!activePreviewUrl}
              title={
                activePreviewUrl ? "Refresh preview" : "No preview to refresh"
              }
              aria-label="Refresh preview"
              className={cn(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors",
                activePreviewUrl
                  ? "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                  : "cursor-not-allowed text-zinc-600",
              )}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <input
              aria-label="Current preview URL"
              title={browserUrl}
              value={browserUrl}
              placeholder="No preview selected"
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
              className="h-11 min-w-56 flex-1 rounded-lg border-0 bg-black/55 px-4 font-mono text-code-sm text-zinc-200 outline-none ring-0 selection:bg-sky-500/30"
            />
            {activePreviewUrl && (
              <a
                href={externalPreviewUrl ?? activePreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open preview in a new tab"
                aria-label="Open preview in a new tab"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {previewControls && (
              <div className="ml-1 flex h-[34px] shrink-0 items-center gap-2 border-l border-white/[0.08] pl-3">
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
            src={iframeBypassedUrl ?? undefined}
            title={iframeTitle}
            reloadKey={previewLoadKey ?? ""}
            onLoad={() => setLoadedPreviewKey(previewLoadKey)}
            onBeforeLoad={onBeforePreviewLoad}
            maxWidthPx={DEVICE_WIDTHS[previewDevice]}
            sandbox={iframeSandbox}
          />
        ) : isResolving ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <Loader2 className="h-7 w-7 animate-spin text-zinc-500" />
            <p className="text-body-sm text-zinc-300">{loadingTitle}</p>
            {loadingDescription && (
              <p className="max-w-md text-body-xs text-zinc-500">
                {loadingDescription}
              </p>
            )}
          </div>
        ) : (
          (emptyState ?? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-body-sm text-zinc-300">No preview to show</p>
            </div>
          ))
        )}
      </div>
    </>
  );
}
