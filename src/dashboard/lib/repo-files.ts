/**
 * @fileType utility
 * @domain kody
 * @pattern repo-files
 * @ai-summary GitHub Contents API client for the file browser.
 *   Wraps the /api/kody/files/* routes which proxy to the GitHub API.
 */

import { getStoredAuth, handleResponse } from "./api";

const API_BASE = "/api/kody/files";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  sha: string;
  downloadUrl: string | null;
}

export interface DirectoryListing {
  entries: FileEntry[];
  path: string;
  ref: string;
}

export interface FileContent {
  content: string;
  path: string;
  ref: string;
  sha: string;
  size: number;
  name: string;
  lastCommit: {
    sha: string;
    author: string;
    date: string;
    message: string;
  } | null;
}

export interface BranchInfo {
  name: string;
  isDefault: boolean;
  protected: boolean;
}

export interface BranchList {
  branches: BranchInfo[];
  defaultBranch: string;
}

export interface SearchResult {
  path: string;
  sha: string;
  text_matches: Array<{
    fragment: string;
    matches: Array<{ indices: [number, number]; text: string }>;
    object_url: string;
    object_type: string;
  }>;
}

export interface SearchResults {
  total: number;
  results: SearchResult[];
  page: number;
  per_page: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  html_url: string;
}

export interface FileDiff {
  patch: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const auth = getStoredAuth();
  return {
    "Content-Type": "application/json",
    ...(auth
      ? {
          "x-kody-token": auth.token,
          "x-kody-owner": auth.owner,
          "x-kody-repo": auth.repo,
        }
      : {}),
    ...extra,
  };
}

// ─── Directory listing ───────────────────────────────────────────────────────

export async function listDir(
  path: string,
  ref?: string,
): Promise<DirectoryListing> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (ref) params.set("ref", ref);
  const url = `${API_BASE}/contents?${params}`;
  const res = await fetch(url, { headers: buildHeaders() });
  return handleResponse<DirectoryListing>(res);
}

// ─── File read ──────────────────────────────────────────────────────────────

export async function readFile(
  path: string,
  ref?: string,
): Promise<FileContent> {
  const params = new URLSearchParams();
  params.set("path", path);
  if (ref) params.set("ref", ref);
  const url = `${API_BASE}/contents?${params}`;
  const res = await fetch(url, { headers: buildHeaders() });
  return handleResponse<FileContent>(res);
}

// ─── File write ─────────────────────────────────────────────────────────────

export async function writeFile(opts: {
  path: string;
  content: string; // raw content (will be base64'd by API)
  sha?: string;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean; sha?: string; commit?: string }> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      operation: "write",
      path: opts.path,
      content: Buffer.from(opts.content, "utf-8").toString("base64"),
      sha: opts.sha,
      message: opts.message,
      ref: opts.ref,
    }),
  });
  return handleResponse(res);
}

// ─── File delete ────────────────────────────────────────────────────────────

export async function deleteFile(opts: {
  path: string;
  sha: string;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      operation: "delete",
      path: opts.path,
      sha: opts.sha,
      message: opts.message,
      ref: opts.ref,
    }),
  });
  return handleResponse(res);
}

// ─── Rename / move ──────────────────────────────────────────────────────────

export async function renameFile(opts: {
  path: string;
  targetPath: string;
  sha: string;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      operation: "rename",
      path: opts.path,
      target: opts.targetPath,
      sha: opts.sha,
      message: opts.message,
      ref: opts.ref,
    }),
  });
  return handleResponse(res);
}

export async function moveFile(opts: {
  path: string;
  targetPath: string;
  sha: string;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      operation: "move",
      path: opts.path,
      target: opts.targetPath,
      sha: opts.sha,
      message: opts.message,
      ref: opts.ref,
    }),
  });
  return handleResponse(res);
}

// ─── Create directory ───────────────────────────────────────────────────────

export async function createDirectory(opts: {
  path: string;
  message?: string;
  ref?: string;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      operation: "mkdir",
      path: opts.path,
      message: opts.message,
      ref: opts.ref,
    }),
  });
  return handleResponse(res);
}

// ─── Search ─────────────────────────────────────────────────────────────────

export async function searchCode(
  query: string,
  ref?: string,
  page = 1,
  perPage = 50,
): Promise<SearchResults> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (ref) params.set("ref", ref);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  const url = `${API_BASE}/search?${params}`;
  const res = await fetch(url, { headers: buildHeaders() });
  return handleResponse<SearchResults>(res);
}

// ─── Branches ───────────────────────────────────────────────────────────────

export async function listBranches(): Promise<BranchList> {
  const res = await fetch(`${API_BASE}/branches`, { headers: buildHeaders() });
  return handleResponse<BranchList>(res);
}

export async function checkBranch(ref: string): Promise<BranchInfo> {
  const params = new URLSearchParams({ ref });
  const res = await fetch(`${API_BASE}/branches?${params}`, {
    headers: buildHeaders(),
  });
  return handleResponse<BranchInfo>(res);
}

// ─── Commits ────────────────────────────────────────────────────────────────

export async function getCommitsForPath(
  path: string,
  ref?: string,
  perPage = 30,
): Promise<{ commits: CommitInfo[] }> {
  const params = new URLSearchParams({ path, per_page: String(perPage) });
  if (ref) params.set("ref", ref);
  const res = await fetch(`${API_BASE}/commits?${params}`, {
    headers: buildHeaders(),
  });
  return handleResponse(res);
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export async function getFileDiff(opts: {
  path: string;
  base: string;
  head: string;
  ref?: string;
}): Promise<FileDiff> {
  const params = new URLSearchParams({
    path: opts.path,
    base: opts.base,
    head: opts.head,
  });
  if (opts.ref) params.set("ref", opts.ref);
  const res = await fetch(`${API_BASE}/diff?${params}`, {
    headers: buildHeaders(),
  });
  return handleResponse<FileDiff>(res);
}

// ─── Default branch ─────────────────────────────────────────────────────────

export async function getDefaultBranch(_ref?: string): Promise<string> {
  const branches = await listBranches();
  return branches.defaultBranch;
}
