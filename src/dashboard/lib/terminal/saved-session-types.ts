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

function hashId(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cleanIdPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "terminal"
  );
}

export function savedTerminalTransportKey(
  transport: SavedTerminalTransport,
  chatSessionId = "",
): string {
  if (transport.type === "fly") {
    return `fly:${transport.app}:${transport.machineId}`;
  }
  if (transport.type === "github-actions") {
    return `github-actions:${transport.sandboxId}`;
  }
  return `local:${transport.sandboxId ?? chatSessionId}`;
}

export function savedTerminalAutoSaveId(
  transport: SavedTerminalTransport,
  chatSessionId: string,
): string {
  const key = savedTerminalTransportKey(transport, chatSessionId);
  return `auto-${hashId(key)}-${cleanIdPart(key)}`.slice(0, 120);
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
