/**
 * @fileType library
 * @domain terminal
 * @pattern bridge-runtime
 *
 * Pure terminal bridge runtime helpers. This module owns terminal byte and
 * lifecycle shaping; Fly provisioning stays in bridge-fly.
 */
import type { TerminalBridgeServerMessage } from "./bridge-protocol";

export const TERMINAL_BRIDGE_RUNTIME_HELPERS_SCRIPT = String.raw`
function normalizeTerminalSize(cols, rows) {
  const nextCols = Number(cols);
  const nextRows = Number(rows);
  if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) return null;
  return {
    cols: Math.min(1000, Math.max(1, Math.floor(nextCols))),
    rows: Math.min(1000, Math.max(1, Math.floor(nextRows))),
  };
}

function stripTerminalMouseInput(value) {
  return String(value || "")
    .replace(/\x1b\[<\d+;\d+;\d+[mM]/g, "")
    .replace(/\x1b\[M[\s\S]{3}/g, "");
}

function restoreStartMessage(outputBuffer) {
  return {
    type: "restore-start",
    replayBytes: Buffer.byteLength(outputBuffer || ""),
  };
}

function restoreCompleteMessage() {
  return { type: "restore-complete" };
}
`;

export function normalizeTerminalSize(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } | null {
  const nextCols = Number(cols);
  const nextRows = Number(rows);
  if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) return null;
  return {
    cols: Math.min(1000, Math.max(1, Math.floor(nextCols))),
    rows: Math.min(1000, Math.max(1, Math.floor(nextRows))),
  };
}

export function stripTerminalMouseInput(value: unknown): string {
  return String(value || "")
    .replace(/\x1b\[<\d+;\d+;\d+[mM]/g, "")
    .replace(/\x1b\[M[\s\S]{3}/g, "");
}

export function restoreStartMessage(
  outputBuffer: string,
): TerminalBridgeServerMessage {
  return {
    type: "restore-start",
    replayBytes: Buffer.byteLength(outputBuffer || ""),
  };
}

export function restoreCompleteMessage(): TerminalBridgeServerMessage {
  return { type: "restore-complete" };
}
