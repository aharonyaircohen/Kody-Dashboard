/**
 * @fileType types
 * @domain terminal
 * @pattern saved-terminal-snapshots
 *
 * Shared client/server contract for durable terminal snapshots. These are
 * snapshots, not guaranteed live process handles.
 */

export const SAVED_TERMINAL_OUTPUT_LIMIT = 16_000;
export const SAVED_TERMINAL_NAME_LIMIT = 64;
export const SAVED_TERMINAL_LIMIT = 40;

export type SavedTerminalTransport =
  | { type: "local"; sandboxId?: string; label?: string }
  | { type: "github-actions"; sandboxId: string; label?: string }
  | { type: "fly"; app: string; machineId: string; label?: string };

export interface SavedTerminalSession {
  id: string;
  name: string;
  transport: SavedTerminalTransport;
  chatSessionId: string;
  cwd?: string;
  shell?: string;
  output: string;
  createdAt: string;
  updatedAt: string;
  savedBy: string;
}

export interface SavedTerminalSessionsDocument {
  version: 1;
  sessions: SavedTerminalSession[];
}

export interface SavedTerminalSnapshotInput {
  id?: string;
  name: string;
  transport: SavedTerminalTransport;
  chatSessionId: string;
  cwd?: string;
  shell?: string;
  output?: string;
}

export function normalizeSavedTerminalActor(login: string): string {
  const normalized = login.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(normalized)) {
    throw new Error("Invalid GitHub login for saved terminal storage");
  }
  return normalized;
}

export function savedTerminalSessionsPath(login: string): string {
  return `terminal/sessions/${normalizeSavedTerminalActor(login)}.json`;
}

export function limitSavedTerminalOutput(output: string): string {
  return output.slice(-SAVED_TERMINAL_OUTPUT_LIMIT);
}

export function terminalTransportLabel(
  transport: SavedTerminalTransport,
): string {
  if (transport.type === "fly") {
    return transport.label ?? `${transport.app} ${transport.machineId}`;
  }
  if (transport.type === "github-actions") {
    return transport.label ?? "GitHub Actions terminal";
  }
  return transport.label ?? "Local terminal";
}
