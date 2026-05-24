/**
 * @fileType ui
 * @domain kody
 * @pattern kody-chat-helpers
 * @ai-summary Small presentational/formatting helpers shared by KodyChat:
 *   boot-phase labels for the Kody Live banner, elapsed-time and file-size
 *   formatters, and the mime-type → icon picker. Pure (no component state).
 */

import {
  Image as ImageIcon,
  FileText,
  FileCode,
} from "lucide-react";

/**
 * Phase label for the Kody Live boot banner. Two timelines because the
 * two backends are wildly different — kody-live boots through GitHub
 * Actions (~90s, dominated by runner provisioning + npx install), while
 * kody-live-fly boots a Fly Machine (~45-60s, dominated by image pull
 * + repo clone + LiteLLM startup, with the last two running in parallel
 * via the runner entrypoint). Estimates only — no API calls.
 */
export function bootPhaseLabel(elapsed: number, runtime: "gh" | "fly"): string {
  if (runtime === "fly") {
    if (elapsed < 12) return "Spawning Fly machine";
    if (elapsed < 35) return "Cloning repo & warming model proxy";
    if (elapsed < 50) return "Starting engine";
    return "Almost ready...";
  }
  if (elapsed < 10) return "Queueing workflow run";
  if (elapsed < 25) return "Setting up GitHub Actions runner";
  if (elapsed < 50) return "Installing Kody engine";
  if (elapsed < 80) return "Starting LiteLLM proxy";
  if (elapsed < 110) return "Warming up model";
  return "Almost ready...";
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
  if (
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("json") ||
    mimeType.includes("html") ||
    mimeType.includes("css")
  ) {
    return <FileCode className="w-4 h-4" />;
  }
  return <FileText className="w-4 h-4" />;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
