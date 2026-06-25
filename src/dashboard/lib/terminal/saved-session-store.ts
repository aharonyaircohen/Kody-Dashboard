/**
 * @fileType utility
 * @domain terminal
 * @pattern saved-terminal-snapshots-state-repo
 *
 * Durable saved terminal snapshots stored as plain JSON in the configured
 * Kody state repo.
 */

import { randomUUID } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import { logger } from "@dashboard/lib/logger";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  limitSavedTerminalOutput,
  savedTerminalSessionsPath,
  SAVED_TERMINAL_LIMIT,
  SAVED_TERMINAL_NAME_LIMIT,
  SAVED_TERMINAL_OUTPUT_LIMIT,
  savedTerminalTransportKey,
  type SavedTerminalSession,
  type SavedTerminalSessionsDocument,
  type SavedTerminalSnapshotInput,
} from "./saved-session-types";

const TransportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local"),
    sandboxId: z.string().min(1).max(80).optional(),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("github-actions"),
    sandboxId: z.string().min(1).max(80),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("fly"),
    app: z.string().min(1).max(120),
    machineId: z.string().min(1).max(120),
    label: z.string().min(1).max(120).optional(),
  }),
]);

const SavedTerminalSessionSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(SAVED_TERMINAL_NAME_LIMIT),
  transport: TransportSchema,
  chatSessionId: z.string().min(1).max(160),
  cwd: z.string().max(1024).optional(),
  shell: z.string().max(160).optional(),
  output: z.string().max(SAVED_TERMINAL_OUTPUT_LIMIT),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  savedBy: z.string().min(1).max(80),
});

const SavedTerminalSessionsDocumentSchema = z.object({
  version: z.literal(1),
  sessions: z.array(SavedTerminalSessionSchema).max(SAVED_TERMINAL_LIMIT),
});

function emptyDoc(): SavedTerminalSessionsDocument {
  return { version: 1, sessions: [] };
}

function sortSessions(
  sessions: SavedTerminalSession[],
): SavedTerminalSession[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function autoSaveDedupeKey(session: SavedTerminalSession): string | null {
  if (!session.name.startsWith("Auto-save: ")) return null;
  return savedTerminalTransportKey(session.transport, session.chatSessionId);
}

function dedupeAutoSavedSessions(
  sessions: SavedTerminalSession[],
): SavedTerminalSession[] {
  const seen = new Set<string>();
  return sortSessions(sessions).filter((session) => {
    const key = autoSaveDedupeKey(session);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeSavedTerminalId(now: Date): string {
  return `terminal-${now.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function parseDoc(
  raw: string,
  owner: string,
  repo: string,
  actorLogin: string,
): SavedTerminalSessionsDocument {
  try {
    const parsed = SavedTerminalSessionsDocumentSchema.parse(JSON.parse(raw));
    return {
      version: 1,
      sessions: dedupeAutoSavedSessions(parsed.sessions),
    };
  } catch (err) {
    logger.warn(
      { err, owner, repo, actorLogin },
      "saved-terminal-sessions: invalid state document",
    );
    return emptyDoc();
  }
}

export async function readSavedTerminalSessions(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
): Promise<{ doc: SavedTerminalSessionsDocument; sha: string | null }> {
  const path = savedTerminalSessionsPath(actorLogin);
  const file = await readStateText(octokit, owner, repo, path, {
    headers: { "If-None-Match": "" },
  });
  if (!file) return { doc: emptyDoc(), sha: null };
  return {
    doc: parseDoc(file.content, owner, repo, actorLogin),
    sha: file.sha ?? null,
  };
}

export async function upsertSavedTerminalSession(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
  input: SavedTerminalSnapshotInput,
  now = new Date(),
): Promise<{
  doc: SavedTerminalSessionsDocument;
  session: SavedTerminalSession;
  sha: string;
}> {
  const { doc, sha } = await readSavedTerminalSessions(
    octokit,
    owner,
    repo,
    actorLogin,
  );
  const timestamp = now.toISOString();
  const existing = input.id
    ? doc.sessions.find((session) => session.id === input.id)
    : null;
  const output = limitSavedTerminalOutput(input.output ?? "");
  const session: SavedTerminalSession = {
    id: existing?.id ?? input.id ?? makeSavedTerminalId(now),
    name: input.name.trim().slice(0, SAVED_TERMINAL_NAME_LIMIT),
    transport: input.transport,
    chatSessionId: input.chatSessionId,
    cwd: input.cwd,
    shell: input.shell,
    output,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    savedBy: actorLogin,
  };
  if (
    existing &&
    existing.name === session.name &&
    JSON.stringify(existing.transport) === JSON.stringify(session.transport) &&
    existing.chatSessionId === session.chatSessionId &&
    existing.cwd === session.cwd &&
    existing.shell === session.shell &&
    existing.output === session.output &&
    existing.savedBy === session.savedBy
  ) {
    return { doc, session: existing, sha: sha ?? "" };
  }

  const next: SavedTerminalSessionsDocument = {
    version: 1,
    sessions: dedupeAutoSavedSessions([
      session,
      ...doc.sessions.filter((item) => item.id !== session.id),
    ]).slice(0, SAVED_TERMINAL_LIMIT),
  };

  const write = await writeStateText({
    octokit,
    owner,
    repo,
    path: savedTerminalSessionsPath(actorLogin),
    content: JSON.stringify(next, null, 2),
    message: "chore(dashboard): save terminal snapshot",
    sha: sha ?? undefined,
  });

  return { doc: next, session, sha: write.sha ?? "" };
}

export async function deleteSavedTerminalSession(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
  id: string,
): Promise<{
  doc: SavedTerminalSessionsDocument;
  deleted: SavedTerminalSession | null;
  sha: string | null;
}> {
  const { doc, sha } = await readSavedTerminalSessions(
    octokit,
    owner,
    repo,
    actorLogin,
  );
  const deleted = doc.sessions.find((session) => session.id === id) ?? null;
  if (!deleted) return { doc, deleted: null, sha };

  const next: SavedTerminalSessionsDocument = {
    version: 1,
    sessions: doc.sessions.filter((session) => session.id !== id),
  };
  const write = await writeStateText({
    octokit,
    owner,
    repo,
    path: savedTerminalSessionsPath(actorLogin),
    content: JSON.stringify(next, null, 2),
    message: "chore(dashboard): delete terminal snapshot",
    sha: sha ?? undefined,
  });

  return { doc: next, deleted, sha: write.sha ?? null };
}
