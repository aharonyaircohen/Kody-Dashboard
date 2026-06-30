/**
 * @fileType types
 * @domain terminal
 * @pattern terminal-checkpoints
 *
 * Shared client/server contract for durable terminal checkpoints. A checkpoint
 * is hidden UI state for one terminal identity, not a user-managed snapshot.
 */

export const TERMINAL_CHECKPOINT_OUTPUT_LIMIT = 16_000;
export const TERMINAL_CHECKPOINT_LIMIT = 40;

export type TerminalCheckpointTransport =
  | { type: "local"; label?: string }
  | {
      type: "fly";
      app: string;
      machineId: string;
      label?: string;
      feature?: "runner" | "brain";
    };

export interface TerminalCheckpointLookup {
  transport: TerminalCheckpointTransport;
  chatSessionId: string;
}

export interface TerminalCheckpoint extends TerminalCheckpointLookup {
  id: string;
  key: string;
  cwd?: string;
  shell?: string;
  output: string;
  createdAt: string;
  updatedAt: string;
  savedBy: string;
}

export interface TerminalCheckpointsDocument {
  version: 1;
  checkpoints: TerminalCheckpoint[];
}

export interface TerminalCheckpointInput extends TerminalCheckpointLookup {
  cwd?: string;
  shell?: string;
  output?: string;
}

export function normalizeTerminalCheckpointActor(login: string): string {
  const normalized = login.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(normalized)) {
    throw new Error("Invalid GitHub login for terminal checkpoint storage");
  }
  return normalized;
}

export function terminalCheckpointsPath(login: string): string {
  return `terminal/checkpoints/${normalizeTerminalCheckpointActor(login)}.json`;
}

export function limitTerminalCheckpointOutput(output: string): string {
  return output.slice(-TERMINAL_CHECKPOINT_OUTPUT_LIMIT);
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

export function terminalCheckpointKey({
  transport,
  chatSessionId,
}: TerminalCheckpointLookup): string {
  if (transport.type === "fly") {
    if (transport.feature === "brain") return "brain:user";
    return `fly:${transport.app}:${transport.machineId}`;
  }
  return `local:${chatSessionId}`;
}

export function terminalCheckpointId(key: string): string {
  return `checkpoint-${hashId(key)}-${cleanIdPart(key)}`.slice(0, 120);
}

export function terminalCheckpointLabel(
  transport: TerminalCheckpointTransport,
): string {
  if (transport.type === "fly") {
    if (transport.feature === "brain") return "Brain terminal";
    return transport.label ?? `${transport.app} ${transport.machineId}`;
  }
  return transport.label ?? "Local terminal";
}
