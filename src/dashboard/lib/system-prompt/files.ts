/**
 * @fileType utility
 * @domain kody
 * @pattern system-prompt-files
 * @ai-summary Read/write the per-repo base system prompt override stored at
 *   `system-prompt.md` in the configured Kody state repo. When present and
 *   non-empty, the engine (kody-live chat) uses it INSTEAD of its built-in
 *   CHAT_SYSTEM_PROMPT — unlike `instructions.md`, which is layered on top.
 *   Empty/absent file → built-in prompt. Mirrors instructions/files.ts.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  deleteStateFile,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "../state-repo";

const SYSTEM_PROMPT_PATH = "system-prompt.md";

export interface SystemPromptFile {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

async function fetchLastCommitDate(octokit: Octokit): Promise<string> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, SYSTEM_PROMPT_PATH),
      per_page: 1,
    });
    return (
      data[0]?.commit.committer?.date ??
      data[0]?.commit.author?.date ??
      new Date().toISOString()
    );
  } catch {
    return new Date().toISOString();
  }
}

export async function readSystemPromptFile(
  octokitOverride?: Octokit,
): Promise<SystemPromptFile | null> {
  const octokit = octokitOverride ?? getOctokit();
  try {
    const file = await readStateText(
      octokit,
      getOwner(),
      getRepo(),
      SYSTEM_PROMPT_PATH,
    );
    if (!file) return null;
    const updatedAt = await fetchLastCommitDate(octokit);
    return {
      body: file.content,
      sha: file.sha,
      updatedAt,
      htmlUrl: file.htmlUrl ?? "",
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  body: string;
  sha?: string;
  message?: string;
}

export async function writeSystemPromptFile(
  opts: WriteOptions,
): Promise<SystemPromptFile> {
  const body = opts.body.endsWith("\n") ? opts.body : `${opts.body}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(system-prompt): ${opts.sha ? "update" : "add"} base prompt override`;

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: SYSTEM_PROMPT_PATH,
    message,
    content: body,
    sha: opts.sha,
  });

  // Confirm with the same octokit that wrote — not the per-request global,
  // which a concurrent request may have cleared (→ 401 "Bad credentials").
  const refreshed = await readSystemPromptFile(opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeSystemPromptFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteSystemPromptFile(octokit: Octokit): Promise<void> {
  const existing = await readSystemPromptFile();
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: SYSTEM_PROMPT_PATH,
    message: "chore(system-prompt): remove base prompt override",
    sha: existing.sha,
  });
}

export { SYSTEM_PROMPT_PATH };
