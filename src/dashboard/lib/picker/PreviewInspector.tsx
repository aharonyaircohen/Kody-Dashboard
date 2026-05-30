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

import { useEffect, useState, type RefObject } from "react";
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
} from "lucide-react";
import { cn } from "../utils";
import { useElementPicker } from "./useElementPicker";
import {
  formatLogs,
  formatNetwork,
  formatPerf,
  formatPickedElement,
  formatPickedElementLabel,
  formatPlaywrightTest,
  PICKER_DOWNLOAD_PATH,
  PICKER_DOCS_URL,
  PICKER_INSTALL_HINT,
} from "./protocol";

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
}: PreviewInspectorProps) {
  const [busy, setBusy] = useState<
    null | "logs" | "network" | "shot" | "perf" | "rec"
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
    onContext({
      id: newId(),
      label: `Test · ${result.steps.length} step(s)`,
      context: formatPlaywrightTest(result.steps, result.url),
    });
    toast.success("Added recorded test to chat");
  };

  return (
    <>
      <button
        type="button"
        onClick={picker.toggle}
        title={
          picker.armed
            ? "Click an element in the preview (Esc to cancel)"
            : "Pick an element from the preview into chat"
        }
        aria-label={picker.armed ? "Picking element" : "Pick element"}
        aria-pressed={picker.armed}
        className={cn(
          BTN_BASE,
          picker.armed
            ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
            : BTN_IDLE,
        )}
      >
        <MousePointerClick className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={sendLogs}
        disabled={busy !== null}
        title={
          picker.logCount > 0
            ? `Send ${picker.logCount} console error(s) to chat`
            : "No console errors captured yet"
        }
        aria-label="Send console errors to chat"
        className={cn(
          BTN_BASE,
          picker.logCount > 0
            ? "bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25"
            : cn(BTN_IDLE, "opacity-60"),
        )}
      >
        <Bug className={cn("w-3 h-3", busy === "logs" && "animate-pulse")} />
        {picker.logCount > 0 && (
          <span className="tabular-nums">{picker.logCount}</span>
        )}
      </button>
      <button
        type="button"
        onClick={sendNetwork}
        disabled={busy !== null}
        title={
          picker.networkCount > 0
            ? `Send ${picker.networkCount} failed request(s) to chat`
            : "No failed requests captured yet"
        }
        aria-label="Send failed requests to chat"
        className={cn(
          BTN_BASE,
          picker.networkCount > 0
            ? "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25"
            : cn(BTN_IDLE, "opacity-60"),
        )}
      >
        <Activity
          className={cn("w-3 h-3", busy === "network" && "animate-pulse")}
        />
        {picker.networkCount > 0 && (
          <span className="tabular-nums">{picker.networkCount}</span>
        )}
      </button>
      <button
        type="button"
        onClick={sendScreenshot}
        disabled={busy !== null}
        title="Screenshot the preview into chat"
        aria-label="Screenshot the preview into chat"
        className={cn(BTN_BASE, BTN_IDLE)}
      >
        <Camera className={cn("w-3 h-3", busy === "shot" && "animate-pulse")} />
      </button>
      <button
        type="button"
        onClick={sendPerf}
        disabled={busy !== null}
        title="Measure the preview's load speed and what's dragging it"
        aria-label="Send a performance snapshot to chat"
        className={cn(BTN_BASE, BTN_IDLE)}
      >
        <Gauge className={cn("w-3 h-3", busy === "perf" && "animate-pulse")} />
      </button>
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
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25"
            : BTN_IDLE,
        )}
      >
        <Globe className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={toggleRecording}
        title={
          picker.recording
            ? "Stop recording and add the test to chat"
            : "Record a click-through, then turn it into a Playwright test"
        }
        aria-pressed={picker.recording}
        className={cn(
          BTN_BASE,
          picker.recording
            ? "bg-red-500/20 text-red-300 border-red-500/50"
            : BTN_IDLE,
        )}
      >
        {picker.recording ? (
          <>
            <Square className="w-3 h-3 fill-current" />
            Stop · {picker.recStepCount}
          </>
        ) : (
          <Circle className="w-3 h-3" />
        )}
      </button>
    </>
  );
}
