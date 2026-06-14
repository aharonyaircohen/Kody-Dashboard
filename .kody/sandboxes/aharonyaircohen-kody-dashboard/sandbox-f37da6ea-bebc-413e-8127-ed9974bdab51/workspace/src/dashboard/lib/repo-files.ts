/**
 * @fileType utility
 * @domain files
 * @pattern repo-files
 * @ai-summary GitHub Contents API wrapper for the /files page. Provides
 *   listDir, readFile, writeFile, deleteFile, moveFile, createSymlink,
 *   uploadFile, searchCode, and commitsForPath — all using the user's
 *   token so permissions match their GitHub access.
 */
"use client";

import type { Octokit } from "@octokit/rest";

// ─── Binary encoding helpers (byte-safe, UTF-8) ──────────────────────────────

/** Decode a base64 string to a UTF-8 string without latin1 corruption. */
export function base64ToString(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Encode a string to base64 using UTF-8, without btoa's latin1 restriction. */
export function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return uint8ToBase64(bytes);
}

/** Byte-safe base64 encoder — handles all uint8 values 0–255. */
function uint8ToBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    result +=
      alphabet[(b0 >> 2) & 0x3f] +
      alphabet[((b0 << 4) | (b1 >> 4)) & 0x3f] +
      alphabet[((b1 << 2) | (b2 >> 6)) & 0x3f] +
      alphabet[b2 & 0x3f];
  }
  const pad = bytes.length % 3;
  if (pad === 1) {
    result = result.slice(0, -2) + "==";
  } else if (pad === 2) {
    result = result.slice(0, -1) + "=";
  }
  return result;
}

/** Compute line number (1-indexed) in a fragment given a byte offset to the match. */
export function lineIndexFromFragment(
  fragment: string,
  matchByteIndex: number,
): number {
  return (fragment.slice(0, matchByteIndex).match(/\n/g)?.length ?? 0) + 1;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  sha: string;
  /** For symlinks only — the target path */
  target?: string;
  /** Last commit info */
  lastCommit?: {
    author: string | null;
    date: string | null;
    message: string;
    sha: string;
  };
}

export interface FileContent {
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: "base64" | "utf-8";
  lastCommit?: {
    author: string | null;
    date: string | null;
    message: string;
    sha: string;
  };
}

export interface SearchResult {
  path: string;
  snippet: string;
  lineInFragment: number | null;
  url: string;
}

export interface CommitInfo {
  sha: string;
  author: string | null;
  date: string | null;
  message: string;
  url: string;
}

// ─── listDir ─────────────────────────────────────────────────────────────────

export async function listDir(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<FileEntry[]> {
  const res = await octokit.rest.repos.getContent({ owner, repo, path });
  const data = res.data;

  if (Array.isArray(data)) {
    return data.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type as "file" | "dir" | "symlink",
      size: item.size ?? 0,
      sha: item.sha ?? "",
      target:
        item.type === "symlink"
          ? (item as { target?: string }).target
          : undefined,
    }));
  }

  // Single item returned means path is a file — caller should use readFile instead
  return [];
}

// ─── readFile ────────────────────────────────────────────────────────────────

export async function readFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<FileContent | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    const data = res.data;

    if (Array.isArray(data)) {
      // It's a directory
      return null;
    }

    if (data.type !== "file") {
      return null;
    }

    const encoding = data.encoding === "base64" ? "base64" : "utf-8";
    const content =
      encoding === "base64"
        ? base64ToString(data.content ?? "")
        : (data.content ?? "");

    return {
      path: data.path ?? path,
      sha: data.sha ?? "",
      size: data.size ?? content.length,
      content,
      encoding,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }
}

// ─── writeFile ───────────────────────────────────────────────────────────────

export async function writeFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string; commitSha: string }> {
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: stringToBase64(content),
    ...(sha ? { sha } : {}),
  });

  return {
    sha: res.data.content?.sha ?? "",
    commitSha: res.data.commit?.sha ?? "",
  };
}

// ─── deleteFile ──────────────────────────────────────────────────────────────

export async function deleteFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha,
  });
}

// ─── moveFile ───────────────────────────────────────────────────────────────

export async function moveFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  sourcePath: string,
  destPath: string,
  message: string,
): Promise<{ sha: string; commitSha: string }> {
  // Read source content
  const file = await readFile(octokit, owner, repo, sourcePath);
  if (!file) throw new Error(`Source file not found: ${sourcePath}`);

  // Get source SHA
  const res = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: sourcePath,
  });
  const data = res.data;
  const sha = Array.isArray(data) ? "" : (data.sha ?? "");

  // Create file at destination, delete source
  const result = await writeFile(
    octokit,
    owner,
    repo,
    destPath,
    file.content,
    message,
  );

  // Delete source (only if dest is different from source)
  if (sourcePath !== destPath) {
    await deleteFile(
      octokit,
      owner,
      repo,
      sourcePath,
      sha,
      `chore: moved to ${destPath}`,
    );
  }

  return result;
}

// ─── createSymlink ──────────────────────────────────────────────────────────

export async function createSymlink(
  octokit: Octokit,
  owner: string,
  repo: string,
  target: string,
  path: string,
  message: string,
): Promise<{ sha: string; commitSha: string }> {
  // GitHub blob type "symlink" stores the target as content
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: target,
    encoding: "utf-8",
  });

  return {
    sha: res.data.content?.sha ?? "",
    commitSha: res.data.commit?.sha ?? "",
  };
}

// ─── uploadFile ──────────────────────────────────────────────────────────────

export async function uploadFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  blob: Blob,
  message: string,
): Promise<{ sha: string; commitSha: string }> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const base64 = uint8ToBase64(bytes);

  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: base64,
  });

  return {
    sha: res.data.content?.sha ?? "",
    commitSha: res.data.commit?.sha ?? "",
  };
}

// ─── searchCode ─────────────────────────────────────────────────────────────

export async function searchCode(
  octokit: Octokit,
  owner: string,
  repo: string,
  query: string,
): Promise<{ total: number; results: SearchResult[] }> {
  const scopedQuery = `${query} repo:${owner}/${repo}`;
  const res = await octokit.rest.search.code({
    q: scopedQuery,
    per_page: 20,
    mediaType: { format: "text-match" },
  });

  type TextMatch = {
    fragment?: string;
    matches?: Array<{ indices?: number[] }>;
  };
  type Hit = {
    path: string;
    html_url: string;
    text_matches?: TextMatch[];
  };

  const results: SearchResult[] = res.data.items.flatMap((item) => {
    const tms = (item as unknown as Hit).text_matches ?? [];
    if (tms.length === 0) {
      return [
        {
          path: item.path,
          snippet: "",
          lineInFragment: null,
          url: item.html_url,
        },
      ];
    }
    return tms.map<SearchResult>((tm) => {
      const fragment = tm.fragment ?? "";
      const firstIdx = tm.matches?.[0]?.indices?.[0] ?? 0;
      const lineInFragment = lineIndexFromFragment(fragment, firstIdx);
      return {
        path: item.path,
        snippet: fragment.slice(0, 600),
        lineInFragment,
        url: item.html_url,
      };
    });
  });

  return {
    total: res.data.total_count,
    results,
  };
}

// ─── commitsForPath ─────────────────────────────────────────────────────────

export async function commitsForPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  perPage = 20,
): Promise<CommitInfo[]> {
  const res = await octokit.rest.repos.listCommits({
    owner,
    repo,
    path,
    per_page: perPage,
  });

  return res.data.map((c) => ({
    sha: c.sha.slice(0, 8),
    author: c.author?.login ?? c.commit.author?.name ?? null,
    date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
    message: c.commit.message.split("\n")[0] ?? "",
    url: c.html_url,
  }));
}

// ─── getFileAtRef ───────────────────────────────────────────────────────────

export async function getFileAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<FileContent | null> {
  return readFile(octokit, owner, repo, path, ref);
}

// ─── checkSymlinkTarget ─────────────────────────────────────────────────────

export async function checkSymlinkTarget(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<{ exists: boolean; target?: string }> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path });
    const data = res.data;
    if (Array.isArray(data)) return { exists: true };
    if (data.type === "symlink") {
      return {
        exists: true,
        target: (data as { target?: string }).target,
      };
    }
    return { exists: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return { exists: false };
    throw err;
  }
}
