/**
 * @fileType utility
 * @domain changelog
 * @pattern github-contents
 * @ai-summary Read/write CHANGELOG.md in the target GitHub repo via the
 *   Contents API. Mirrors the vault/store.ts pattern. Includes a small
 *   read-modify-write retry on SHA conflict (409) for concurrent webhook
 *   appends from near-simultaneous merges.
 */

import { Octokit } from "@octokit/rest";
import { writeGitHubFileWithRetry } from "@dashboard/lib/github-contents-write";
import { resolveBackgroundToken } from "../auth/background-token";

export const CHANGELOG_PATH = "CHANGELOG.md";

interface RawContents {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  html_url?: string;
}

export interface ChangelogFile {
  content: string;
  sha: string | null;
  htmlUrl: string | null;
}

/**
 * Server-only Octokit for webhook handlers — App installation token
 * preferred, vault `GITHUB_TOKEN` fallback. Never a shared human PAT: webhook
 * traffic would drain (and flag) that account, breaking every dashboard read.
 * Returns null when neither token source is available for this repo.
 */
export async function getServerOctokit(
  owner: string,
  repo: string,
): Promise<Octokit | null> {
  const bg = await resolveBackgroundToken(owner, repo);
  if (!bg) return null;
  return new Octokit({ auth: bg.token });
}

export async function readChangelog(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<ChangelogFile> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: CHANGELOG_PATH,
      ...(ref ? { ref } : {}),
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContents | RawContents[];
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      return { content: "", sha: null, htmlUrl: null };
    }
    const buf = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    );
    return {
      content: buf.toString("utf8"),
      sha: data.sha ?? null,
      htmlUrl: data.html_url ?? null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return { content: "", sha: null, htmlUrl: null };
    throw err;
  }
}

export async function writeChangelog(
  octokit: Octokit,
  owner: string,
  repo: string,
  content: string,
  currentSha: string | null,
  commitMessage: string,
  maxAttempts = 2,
): Promise<{ sha: string | null }> {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const res = await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path: CHANGELOG_PATH,
    message: commitMessage,
    content: encoded,
    ...(currentSha ? { sha: currentSha } : {}),
    maxAttempts,
  });
  return { sha: res.sha };
}

/**
 * Read-modify-write helper. Retries on 409 (SHA conflict) up to `maxAttempts`
 * times, re-reading the latest SHA each round. `mutate` is a pure function
 * that returns the new file body; returning the input unchanged short-circuits
 * the write (idempotent no-op).
 */
export async function updateChangelog(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitMessage: string,
  mutate: (current: string) => string,
  maxAttempts = 3,
): Promise<{ written: boolean; sha: string | null }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = await readChangelog(octokit, owner, repo);
    const next = mutate(current.content);
    if (next === current.content) {
      return { written: false, sha: current.sha };
    }
    try {
      const { sha } = await writeChangelog(
        octokit,
        owner,
        repo,
        next,
        current.sha,
        commitMessage,
        1,
      );
      return { written: true, sha };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 150 * attempt));
        continue;
      }
      throw err;
    }
  }
  return { written: false, sha: null };
}
