/**
 * @fileType component
 * @domain picker
 * @pattern preview-inspector-toolbar
 * @ai-summary Toolbar buttons that drive the Kody Preview Inspector extension —
 *   pick an element, send console errors / failed requests, and screenshot the
 *   preview into chat. Shared by PreviewModal and VibePage. Emits results via
 *   `onContext` (a composer chip) and `onAttachment` (a chat image); the host
 *   decides where those go. Renders an install link when the extension is
 *   absent.
 */
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import {
  Bug,
  Activity,
  Camera,
  Gauge,
  Circle,
  Square,
  MousePointerClick,
  Globe,
  Puzzle,
  ChevronDown,
} from "lucide-react";
import { cn } from "../utils";
import { useElementPicker } from "./useElementPicker";
import {
  formatLogs,
  formatNetwork,
  formatPerf,
  formatPickedElement,
  formatPickedElementLabel,
  PICKER_DOWNLOAD_PATH,
  PICKER_DOCS_URL,
  PICKER_INSTALL_HINT,
  type PreviewAction,
} from "./protocol";
import { recordedStepToAction } from "../macros";
import { PreviewMacrosMenu } from "../components/PreviewMacrosMenu";

export interface ComposerChip {
  id: string;
  label: string;
  context: string;
}
export interface AttachmentInjection {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

interface PreviewInspectorProps {
  /** The preview area element — used to crop screenshots to the preview. */
  previewRef: RefObject<HTMLElement | null>;
  /** Emit a composer context chip (picked element, console errors, network). */
  onContext: (chip: ComposerChip) => void;
  /** Emit a chat image attachment (preview screenshot). */
  onAttachment: (attachment: AttachmentInjection) => void;
  /** Repo identity for per-repo storage (saved macros, etc.). */
  owner: string;
  repo: string;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const BTN_BASE =
  "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_IDLE =
  "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border-zinc-700";

// Source of truth for the "auto-attach page context to every send" toggle.
// Lives here (not in KodyChat) because the toggle UI is preview-only — chat
// reads the persisted flag and silently injects the snapshot when on.
const AUTO_CONTEXT_KEY = "kody:preview-auto-context";

export function PreviewInspector({
  previewRef,
  onContext,
  onAttachment,
  owner,
  repo,
}: PreviewInspectorProps) {
  const [busy, setBusy] = useState<
    null | "logs" | "network" | "shot" | "perf" | "rec"
  >(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const diagnosticMenuRef = useRef<HTMLDivElement | null>(null);
  const [diagnosticMenuOpen, setDiagnosticMenuOpen] = useState(false);
  // Hoisted above the "not installed" early-return below so hooks order
  // stays stable per React's rules-of-hooks.
  const [pendingMacroSteps, setPendingMacroSteps] = useState<
    PreviewAction[] | null
  >(null);
  // The URL the preview was on when the recording started. Replay needs
  // this so the macro can navigate back to its starting page before
  // running its steps — otherwise selectors recorded on /admin/users
  // mysteriously "not found" when the user is sitting on /dashboard.
  const [pendingMacroStartUrl, setPendingMacroStartUrl] = useState<
    string | null
  >(null);
  const [autoContext, setAutoContext] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = window.localStorage.getItem(AUTO_CONTEXT_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_CONTEXT_KEY, autoContext ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [autoContext]);

  useEffect(() => {
    if (!actionMenuOpen) return;

    const onDocumentClick = (event: MouseEvent): void => {
      if (!actionMenuRef.current) return;
      if (
        event.target instanceof Node &&
        actionMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setActionMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setActionMenuOpen(false);
    };

    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [actionMenuOpen]);

  useEffect(() => {
    if (!diagnosticMenuOpen) return;

    const onDocumentClick = (event: MouseEvent): void => {
      if (!diagnosticMenuRef.current) return;
      if (
        event.target instanceof Node &&
        diagnosticMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setDiagnosticMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDiagnosticMenuOpen(false);
    };

    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [diagnosticMenuOpen]);

  const picker = useElementPicker({
    onSelect: (el) => {
      onContext({
        id: newId(),
        label: formatPickedElementLabel(el),
        context: formatPickedElement(el),
      });
      toast.success(`Added ${formatPickedElementLabel(el)} to chat`);
    },
  });

  if (!picker.available) {
    return (
      <a
        href={PICKER_DOWNLOAD_PATH}
        download
        onClick={() =>
          toast.info(PICKER_INSTALL_HINT, {
            duration: 12000,
            action: {
              label: "Guide",
              onClick: () => window.open(PICKER_DOCS_URL, "_blank"),
            },
          })
        }
        title="Download the Kody Preview Inspector, then load it unpacked"
        className={cn(BTN_BASE, "text-zinc-400", BTN_IDLE)}
      >
        <Puzzle className="w-3 h-3" />
        Get inspector
      </a>
    );
  }

  const sendLogs = async () => {
    setBusy("logs");
    try {
      const logs = await picker.collectLogs();
      if (!logs.length) {
        toast.info("No console errors captured from the preview");
        return;
      }
      onContext({
        id: newId(),
        label: `${logs.length} console ${logs.length === 1 ? "error" : "errors"}`,
        context: formatLogs(logs),
      });
      toast.success("Added console output to chat");
    } finally {
      setBusy(null);
    }
  };

  const sendNetwork = async () => {
    setBusy("network");
    try {
      const net = await picker.collectNetwork();
      if (!net.length) {
        toast.info("No failed requests captured from the preview");
        return;
      }
      onContext({
        id: newId(),
        label: `${net.length} failed ${net.length === 1 ? "request" : "requests"}`,
        context: formatNetwork(net),
      });
      toast.success("Added failed requests to chat");
    } finally {
      setBusy(null);
    }
  };

  const sendScreenshot = async () => {
    setBusy("shot");
    try {
      const rect = previewRef.current?.getBoundingClientRect();
      const clip = rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : undefined;
      const { dataUrl, error } = await picker.captureScreenshot(clip);
      if (!dataUrl) {
        toast.error(
          `Couldn't capture a screenshot: ${error ?? "unknown error"}`,
        );
        return;
      }
      onAttachment({
        id: newId(),
        name: `preview-${Date.now()}.png`,
        dataUrl,
        mimeType: "image/png",
      });
      toast.success("Added preview screenshot to chat");
    } finally {
      setBusy(null);
    }
  };

  const sendPerf = async () => {
    setBusy("perf");
    try {
      const report = await picker.collectPerf();
      if (!report) {
        toast.error("Couldn't read performance from the preview");
        return;
      }
      onContext({
        id: newId(),
        label: report.lcpMs
          ? `Speed · LCP ${(report.lcpMs / 1000).toFixed(1)}s`
          : "Speed snapshot",
        context: formatPerf(report),
      });
      toast.success("Added performance snapshot to chat");
    } finally {
      setBusy(null);
    }
  };

  const toggleRecording = async () => {
    if (!picker.recording) {
      picker.startRecording();
      toast.info("Recording — click through the preview, then press Stop");
      return;
    }
    const result = await picker.stopRecording();
    if (!result || !result.steps.length) {
      toast.info("No steps recorded");
      return;
    }
    // Translate the raw recorder steps into the replayable PreviewAction
    // shape macros store and replay through preview_act.
    const actions = result.steps
      .map(recordedStepToAction)
      .filter((a): a is PreviewAction => a !== null);
    if (actions.length === 0) {
      toast.info("No usable steps recorded");
      return;
    }
    setPendingMacroSteps(actions);
    setPendingMacroStartUrl(result.url || null);
    toast.info(`Recorded ${actions.length} step(s) — name and save`);
  };

  const diagnosticCount = picker.logCount + picker.networkCount;
  const diagnosticBusy =
    busy === "logs" || busy === "network" || busy === "perf";

  // Keep extension actions behind compact menus; settings stays one tap.
  const groupClass =
    "inline-flex items-center gap-0.5 p-0.5 rounded-md border bg-zinc-900/50";

  return (
    <>
      <div ref={actionMenuRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => {
            setActionMenuOpen((open) => !open);
            setDiagnosticMenuOpen(false);
          }}
          title="Inspector actions"
          aria-label="Inspector actions"
          aria-haspopup="menu"
          aria-expanded={actionMenuOpen}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
            picker.recording
              ? "border-red-500/50 bg-red-500/20 text-red-300"
              : picker.armed || pendingMacroSteps
                ? "border-blue-400/50 bg-blue-500/20 text-blue-200 hover:bg-blue-500/25"
                : "border-blue-500/20 bg-blue-500/10 text-blue-300/80 hover:bg-blue-500/15 hover:text-blue-200",
          )}
        >
          {picker.recording ? (
            <>
              <Square className="h-3 w-3 fill-current" />
              <span className="tabular-nums">{picker.recStepCount}</span>
            </>
          ) : picker.armed ? (
            <MousePointerClick className="h-3 w-3" />
          ) : (
            <Puzzle className="h-3 w-3" />
          )}
          <ChevronDown className="h-3 w-3" />
        </button>

        {actionMenuOpen && (
          <div
            role="menu"
            aria-label="Inspector actions"
            className="absolute right-0 top-full z-50 mt-1 min-w-52 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                picker.toggle();
                setActionMenuOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                picker.armed
                  ? "text-blue-200"
                  : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
              )}
            >
              <MousePointerClick className="h-3 w-3" />
              <span className="flex-1">
                {picker.armed ? "Cancel picker" : "Pick element"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void sendScreenshot();
                setActionMenuOpen(false);
              }}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              <Camera
                className={cn("h-3 w-3", busy === "shot" && "animate-pulse")}
              />
              <span className="flex-1">Screenshot</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void toggleRecording()}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                picker.recording
                  ? "text-red-300 hover:bg-red-500/10"
                  : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
              )}
            >
              {picker.recording ? (
                <Square className="h-3 w-3 fill-current" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="flex-1">
                {picker.recording ? "Stop recording" : "Record macro"}
              </span>
              {picker.recording && (
                <span className="tabular-nums">{picker.recStepCount}</span>
              )}
            </button>
            <PreviewMacrosMenu
              owner={owner}
              repo={repo}
              pendingSteps={pendingMacroSteps}
              pendingStartUrl={pendingMacroStartUrl}
              onPendingHandled={() => {
                setPendingMacroSteps(null);
                setPendingMacroStartUrl(null);
              }}
              onContext={onContext}
              act={picker.act}
              pickerAvailable={picker.available}
              variant="menu"
            />
          </div>
        )}
      </div>
      {/* Group 2 - DIAGNOSTICS: passive observers of the preview. */}
      <div ref={diagnosticMenuRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => {
            setDiagnosticMenuOpen((open) => !open);
            setActionMenuOpen(false);
          }}
          title="Diagnostics"
          aria-label="Diagnostics"
          aria-haspopup="menu"
          aria-expanded={diagnosticMenuOpen}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
            picker.logCount > 0
              ? "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : picker.networkCount > 0
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : "border-amber-500/20 bg-amber-500/10 text-amber-300/70 hover:bg-amber-500/15 hover:text-amber-200",
          )}
        >
          {picker.logCount > 0 ? (
            <Bug className={cn("h-3 w-3", diagnosticBusy && "animate-pulse")} />
          ) : picker.networkCount > 0 ? (
            <Activity
              className={cn("h-3 w-3", diagnosticBusy && "animate-pulse")}
            />
          ) : (
            <Gauge
              className={cn("h-3 w-3", diagnosticBusy && "animate-pulse")}
            />
          )}
          {diagnosticCount > 0 && (
            <span className="tabular-nums">{diagnosticCount}</span>
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
        {diagnosticMenuOpen && (
          <div
            role="menu"
            aria-label="Diagnostics"
            className="absolute right-0 top-full z-50 mt-1 min-w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDiagnosticMenuOpen(false);
                void sendLogs();
              }}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              <Bug
                className={cn("h-3 w-3", busy === "logs" && "animate-pulse")}
              />
              <span className="flex-1">Console errors</span>
              {picker.logCount > 0 && (
                <span className="tabular-nums text-red-300">
                  {picker.logCount}
                </span>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDiagnosticMenuOpen(false);
                void sendNetwork();
              }}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              <Activity
                className={cn("h-3 w-3", busy === "network" && "animate-pulse")}
              />
              <span className="flex-1">Failed requests</span>
              {picker.networkCount > 0 && (
                <span className="tabular-nums text-amber-300">
                  {picker.networkCount}
                </span>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDiagnosticMenuOpen(false);
                void sendPerf();
              }}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              <Gauge
                className={cn("h-3 w-3", busy === "perf" && "animate-pulse")}
              />
              <span className="flex-1">Performance snapshot</span>
            </button>
          </div>
        )}
      </div>

      {/* Group 3 — SETTINGS: per-chat context behaviour. Emerald = active. */}
      <div
        className={cn(groupClass, "border-emerald-500/20")}
        role="group"
        aria-label="Inspector settings"
      >
        <button
          type="button"
          onClick={() => setAutoContext((v) => !v)}
          aria-pressed={autoContext}
          title={
            autoContext
              ? "Auto page context: ON — preview URL + DOM sent silently with every chat message"
              : "Auto page context: OFF — click to send preview context with every chat message"
          }
          className={cn(
            BTN_BASE,
            autoContext
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/50"
              : "text-emerald-300/60 hover:text-emerald-200 hover:bg-emerald-500/10 border-transparent",
          )}
        >
          <Globe className="w-3 h-3" />
        </button>
      </div>
    </>
  );
}
