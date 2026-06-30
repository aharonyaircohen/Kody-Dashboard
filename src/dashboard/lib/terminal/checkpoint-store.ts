/**
 * @fileType utility
 * @domain terminal
 * @pattern terminal-checkpoints-state-repo
 *
 * Durable terminal checkpoints stored as one hidden checkpoint per terminal
 * identity in the configured Kody state repo.
 */

import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import { logger } from "@dashboard/lib/logger";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  limitTerminalCheckpointOutput,
  TERMINAL_CHECKPOINT_LIMIT,
  TERMINAL_CHECKPOINT_OUTPUT_LIMIT,
  terminalCheckpointId,
  terminalCheckpointKey,
  terminalCheckpointsPath,
  type TerminalCheckpoint,
  type TerminalCheckpointInput,
  type TerminalCheckpointsDocument,
  type TerminalCheckpointLookup,
} from "./checkpoint-types";

const TransportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local"),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("fly"),
    app: z.string().min(1).max(120),
    machineId: z.string().min(1).max(120),
    label: z.string().min(1).max(120).optional(),
    feature: z.enum(["runner", "brain"]).optional(),
  }),
]);

const TerminalCheckpointSchema = z.object({
  id: z.string().min(1).max(120),
  key: z.string().min(1).max(160),
  transport: TransportSchema,
  chatSessionId: z.string().min(1).max(160),
  cwd: z.string().max(1024).optional(),
  shell: z.string().max(160).optional(),
  output: z.string().max(TERMINAL_CHECKPOINT_OUTPUT_LIMIT),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  savedBy: z.string().min(1).max(80),
});

const TerminalCheckpointsDocumentSchema = z.object({
  version: z.literal(1),
  checkpoints: z.array(z.unknown()).max(TERMINAL_CHECKPOINT_LIMIT),
});

function emptyDoc(): TerminalCheckpointsDocument {
  return { version: 1, checkpoints: [] };
}

function sortCheckpoints(
  checkpoints: TerminalCheckpoint[],
): TerminalCheckpoint[] {
  return [...checkpoints].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function normalizeCheckpoints(
  checkpoints: TerminalCheckpoint[],
): TerminalCheckpoint[] {
  const seen = new Set<string>();
  return sortCheckpoints(checkpoints).filter((checkpoint) => {
    if (seen.has(checkpoint.key)) return false;
    seen.add(checkpoint.key);
    return true;
  });
}

function parseDoc(
  raw: string,
  owner: string,
  repo: string,
  actorLogin: string,
): TerminalCheckpointsDocument {
  try {
    const parsed = TerminalCheckpointsDocumentSchema.parse(JSON.parse(raw));
    const checkpoints = parsed.checkpoints.flatMap((checkpoint) => {
      const result = TerminalCheckpointSchema.safeParse(checkpoint);
      return result.success ? [result.data] : [];
    });
    return {
      version: 1,
      checkpoints: normalizeCheckpoints(checkpoints),
    };
  } catch (err) {
    logger.warn(
      { err, owner, repo, actorLogin },
      "terminal-checkpoints: invalid state document",
    );
    return emptyDoc();
  }
}

export async function readTerminalCheckpoints(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
): Promise<{ doc: TerminalCheckpointsDocument; sha: string | null }> {
  const path = terminalCheckpointsPath(actorLogin);
  const file = await readStateText(octokit, owner, repo, path, {
    headers: { "If-None-Match": "" },
  });
  if (!file) return { doc: emptyDoc(), sha: null };
  return {
    doc: parseDoc(file.content, owner, repo, actorLogin),
    sha: file.sha ?? null,
  };
}

export async function getTerminalCheckpoint(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
  lookup: TerminalCheckpointLookup,
): Promise<{
  doc: TerminalCheckpointsDocument;
  checkpoint: TerminalCheckpoint | null;
  sha: string | null;
}> {
  const { doc, sha } = await readTerminalCheckpoints(
    octokit,
    owner,
    repo,
    actorLogin,
  );
  const key = terminalCheckpointKey(lookup);
  return {
    doc,
    checkpoint:
      doc.checkpoints.find((checkpoint) => checkpoint.key === key) ?? null,
    sha,
  };
}

export async function upsertTerminalCheckpoint(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
  input: TerminalCheckpointInput,
  now = new Date(),
): Promise<{
  doc: TerminalCheckpointsDocument;
  checkpoint: TerminalCheckpoint;
  sha: string;
}> {
  const { doc, sha } = await readTerminalCheckpoints(
    octokit,
    owner,
    repo,
    actorLogin,
  );
  const key = terminalCheckpointKey(input);
  const existing =
    doc.checkpoints.find((checkpoint) => checkpoint.key === key) ?? null;
  const timestamp = now.toISOString();
  const output = limitTerminalCheckpointOutput(input.output ?? "");
  const checkpoint: TerminalCheckpoint = {
    id: existing?.id ?? terminalCheckpointId(key),
    key,
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
    JSON.stringify(existing.transport) ===
      JSON.stringify(checkpoint.transport) &&
    existing.chatSessionId === checkpoint.chatSessionId &&
    existing.cwd === checkpoint.cwd &&
    existing.shell === checkpoint.shell &&
    existing.output === checkpoint.output &&
    existing.savedBy === checkpoint.savedBy
  ) {
    return { doc, checkpoint: existing, sha: sha ?? "" };
  }

  const next: TerminalCheckpointsDocument = {
    version: 1,
    checkpoints: normalizeCheckpoints([
      checkpoint,
      ...doc.checkpoints.filter((item) => item.key !== key),
    ]).slice(0, TERMINAL_CHECKPOINT_LIMIT),
  };

  const write = await writeStateText({
    octokit,
    owner,
    repo,
    path: terminalCheckpointsPath(actorLogin),
    content: JSON.stringify(next, null, 2),
    message: "chore(dashboard): save terminal checkpoint",
    sha: sha ?? undefined,
  });

  return { doc: next, checkpoint, sha: write.sha ?? "" };
}

export async function deleteTerminalCheckpoint(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorLogin: string,
  lookup: TerminalCheckpointLookup,
): Promise<{
  doc: TerminalCheckpointsDocument;
  deleted: TerminalCheckpoint | null;
  sha: string | null;
}> {
  const { doc, sha } = await readTerminalCheckpoints(
    octokit,
    owner,
    repo,
    actorLogin,
  );
  const key = terminalCheckpointKey(lookup);
  const deleted =
    doc.checkpoints.find((checkpoint) => checkpoint.key === key) ?? null;
  if (!deleted) return { doc, deleted: null, sha };

  const next: TerminalCheckpointsDocument = {
    version: 1,
    checkpoints: doc.checkpoints.filter((checkpoint) => checkpoint.key !== key),
  };
  const write = await writeStateText({
    octokit,
    owner,
    repo,
    path: terminalCheckpointsPath(actorLogin),
    content: JSON.stringify(next, null, 2),
    message: "chore(dashboard): delete terminal checkpoint",
    sha: sha ?? undefined,
  });

  return { doc: next, deleted, sha: write.sha ?? null };
}
