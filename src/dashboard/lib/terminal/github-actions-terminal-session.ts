/**
 * @fileType utility
 * @domain terminal
 * @pattern github-actions-terminal-session
 *
 * Line-based terminal bridge backed by GitHub Actions and repo files.
 */
import { randomUUID } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { NextRequest } from "next/server";
import { getUserOctokit } from "@dashboard/lib/auth";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  getLocalSandbox,
  saveLocalSandboxSnapshot,
} from "@dashboard/lib/sandboxes/local-sandboxes";
import { ensureGitHubActionsSandboxSnapshotWithOctokit } from "@dashboard/lib/sandboxes/github-actions-snapshot";

export interface TerminalSessionState {
  sessionId: string;
  cwd: string;
  shell: string;
  cursor: number;
  alive: boolean;
}

interface GitHubRepoAuth {
  owner: string;
  repo: string;
}

const WORKFLOW_REF = "main";
const TERMINAL_DIR = "terminal";
const SANDBOX_ID_RE = /^sandbox-[0-9a-f-]{36}$/i;

function terminalPath(sessionId: string, file: string): string {
  return `${TERMINAL_DIR}/${sessionId}/${file}`;
}

async function getFile(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  path: string,
): Promise<{ sha?: string; text: string }> {
  const file = await readStateText(octokit, auth.owner, auth.repo, path);
  return file ? { sha: file.sha, text: file.content } : { text: "" };
}

async function writeFile(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  path: string,
  text: string,
  message: string,
): Promise<void> {
  const existing = await getFile(octokit, auth, path);
  await writeStateText({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
    path,
    message,
    content: text,
    ...(existing.sha ? { sha: existing.sha } : {}),
  });
}

async function appendJsonLine(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  path: string,
  value: unknown,
  message: string,
): Promise<void> {
  const existing = await getFile(octokit, auth, path);
  const next = `${existing.text}${JSON.stringify(value)}\n`;
  await writeFile(octokit, auth, path, next, message);
}

export async function startGitHubActionsTerminalSession(
  req: NextRequest,
  auth: GitHubRepoAuth,
  input: { chatSessionId?: string; sandboxId: string },
): Promise<TerminalSessionState> {
  if (!SANDBOX_ID_RE.test(input.sandboxId))
    throw new Error("Invalid sandbox id");
  const sandbox = await getLocalSandbox(auth, input.sandboxId);
  if (!sandbox || sandbox.runtime !== "github-actions") {
    throw new Error("GitHub Actions sandbox not found");
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");

  const savedSandbox = sandbox.snapshotUpdatedAt
    ? sandbox
    : await saveLocalSandboxSnapshot(auth, input.sandboxId);
  await ensureGitHubActionsSandboxSnapshotWithOctokit(
    octokit,
    auth,
    savedSandbox,
  );

  const sessionId = `gha-terminal-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await writeFile(
    octokit,
    auth,
    terminalPath(sessionId, "input.jsonl"),
    "",
    `chore(kody): start terminal ${sessionId} [skip ci]`,
  );
  await appendJsonLine(
    octokit,
    auth,
    terminalPath(sessionId, "output.jsonl"),
    {
      id: 1,
      type: "output",
      data: "Starting GitHub Actions terminal...\r\n",
      at: new Date().toISOString(),
    },
    `chore(kody): init terminal output ${sessionId} [skip ci]`,
  );

  await octokit.actions.createWorkflowDispatch({
    owner: auth.owner,
    repo: auth.repo,
    workflow_id: "kody-terminal.yml",
    ref: WORKFLOW_REF,
    inputs: {
      terminalSessionId: sessionId,
      sandboxId: input.sandboxId,
    },
  });

  return {
    sessionId,
    cwd: "/workspace",
    shell: "github-actions",
    cursor: 0,
    alive: true,
  };
}

export async function writeGitHubActionsTerminalInput(
  req: NextRequest,
  auth: GitHubRepoAuth,
  sessionId: string,
  command: string,
): Promise<void> {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");
  await appendJsonLine(
    octokit,
    auth,
    terminalPath(sessionId, "input.jsonl"),
    { type: "command", command, at: new Date().toISOString() },
    `chore(kody): terminal input ${sessionId} [skip ci]`,
  );
}

export async function stopGitHubActionsTerminalSession(
  req: NextRequest,
  auth: GitHubRepoAuth,
  sessionId: string,
): Promise<void> {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");
  await appendJsonLine(
    octokit,
    auth,
    terminalPath(sessionId, "input.jsonl"),
    { type: "stop", at: new Date().toISOString() },
    `chore(kody): stop terminal ${sessionId} [skip ci]`,
  );
}

export async function readGitHubActionsTerminalEvents(
  req: NextRequest,
  auth: GitHubRepoAuth,
  sessionId: string,
  cursor: number,
): Promise<{ events: unknown[]; cursor: number; alive: boolean }> {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");
  const file = await getFile(
    octokit,
    auth,
    terminalPath(sessionId, "output.jsonl"),
  );
  const lines = file.text.split("\n").filter(Boolean);
  const events = lines
    .slice(cursor)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { events, cursor: lines.length, alive: true };
}
