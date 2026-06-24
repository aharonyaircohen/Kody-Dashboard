/** Shared GitHub Contents API write helpers with stale-SHA retry. */

interface GitHubContentsApi {
  getContent: (params: {
    owner: string;
    repo: string;
    path: string;
    ref?: string;
    headers?: Record<string, string>;
  }) => Promise<{ data: unknown; headers?: unknown }>;
  createOrUpdateFileContents: (params: {
    owner: string;
    repo: string;
    path: string;
    message: string;
    content: string;
    branch?: string;
    sha?: string;
    encoding?: string;
  }) => Promise<{ data: unknown }>;
}

interface GitHubContentsOctokitLike {
  rest?: { repos?: unknown };
  repos?: unknown;
}

export interface GitHubFileSnapshot {
  contentBase64: string | null;
  sha: string | null;
  htmlUrl: string | null;
}

export interface GitHubFileWriteResult {
  sha: string | null;
  commitSha: string | null;
  htmlUrl: string | null;
}

export interface WriteGitHubFileOptions {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  branch?: string;
  sha?: string | null;
  encoding?: string;
  maxAttempts?: number;
}

export interface UpdateGitHubFileOptions {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
  message: string;
  maxAttempts?: number;
  onConflict?: () => void;
  mutate: (
    current: GitHubFileSnapshot | null,
  ) =>
    | { content: string; message?: string; encoding?: string }
    | null
    | Promise<{ content: string; message?: string; encoding?: string } | null>;
}

function getReposApi(octokit: unknown): GitHubContentsApi {
  const candidate = octokit as GitHubContentsOctokitLike;
  const repos = candidate.rest?.repos ?? candidate.repos;
  if (!repos || typeof repos !== "object") {
    throw new Error("github_contents_api_missing");
  }
  return repos as GitHubContentsApi;
}

function getHttpStatus(err: unknown): number | undefined {
  return err && typeof err === "object"
    ? (err as { status?: number }).status
    : undefined;
}

export function isGitHubContentsShaConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const response = record.response;
  const responseData =
    response && typeof response === "object"
      ? (response as { data?: unknown }).data
      : undefined;
  const responseMessage =
    responseData && typeof responseData === "object"
      ? (responseData as { message?: unknown }).message
      : undefined;
  const message = [record.message, responseMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return record.status === 409 || message.includes("does not match");
}

function normalizeSnapshot(data: unknown): GitHubFileSnapshot | null {
  if (Array.isArray(data) || !data || typeof data !== "object") return null;
  const file = data as {
    content?: unknown;
    sha?: unknown;
    html_url?: unknown;
  };
  return {
    contentBase64: typeof file.content === "string" ? file.content : null,
    sha: typeof file.sha === "string" ? file.sha : null,
    htmlUrl: typeof file.html_url === "string" ? file.html_url : null,
  };
}

function normalizeWriteResult(data: unknown): GitHubFileWriteResult {
  const result =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const content =
    result.content && typeof result.content === "object"
      ? (result.content as Record<string, unknown>)
      : {};
  const commit =
    result.commit && typeof result.commit === "object"
      ? (result.commit as Record<string, unknown>)
      : {};
  return {
    sha: typeof content.sha === "string" ? content.sha : null,
    commitSha: typeof commit.sha === "string" ? commit.sha : null,
    htmlUrl: typeof content.html_url === "string" ? content.html_url : null,
  };
}

export async function readGitHubFileForWrite(
  octokit: unknown,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<GitHubFileSnapshot | null> {
  try {
    const res = await getReposApi(octokit).getContent({
      owner,
      repo,
      path,
      ...(branch ? { ref: branch } : {}),
    });
    return normalizeSnapshot(res.data);
  } catch (err) {
    if (getHttpStatus(err) === 404) return null;
    throw err;
  }
}

export async function writeGitHubFileWithRetry(
  octokit: unknown,
  opts: WriteGitHubFileOptions,
): Promise<GitHubFileWriteResult> {
  const repos = getReposApi(octokit);
  const maxAttempts = opts.maxAttempts ?? 2;
  let sha = opts.sha ?? null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await repos.createOrUpdateFileContents({
        owner: opts.owner,
        repo: opts.repo,
        path: opts.path,
        message: opts.message,
        content: opts.content,
        ...(opts.branch ? { branch: opts.branch } : {}),
        ...(opts.encoding ? { encoding: opts.encoding } : {}),
        ...(sha ? { sha } : {}),
      });
      return normalizeWriteResult(res.data);
    } catch (err) {
      if (attempt >= maxAttempts || !isGitHubContentsShaConflict(err)) {
        throw err;
      }
      const latest = await readGitHubFileForWrite(
        octokit,
        opts.owner,
        opts.repo,
        opts.path,
        opts.branch,
      );
      sha = latest?.sha ?? null;
    }
  }

  throw new Error("github_contents_write_retry_exhausted");
}

export async function updateGitHubFileWithRetry(
  octokit: unknown,
  opts: UpdateGitHubFileOptions,
): Promise<GitHubFileWriteResult & { written: boolean }> {
  const maxAttempts = opts.maxAttempts ?? 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await readGitHubFileForWrite(
      octokit,
      opts.owner,
      opts.repo,
      opts.path,
      opts.branch,
    );
    const next = await opts.mutate(current);
    if (!next) {
      return {
        written: false,
        sha: current?.sha ?? null,
        commitSha: null,
        htmlUrl: current?.htmlUrl ?? null,
      };
    }

    try {
      const result = await writeGitHubFileWithRetry(octokit, {
        owner: opts.owner,
        repo: opts.repo,
        path: opts.path,
        branch: opts.branch,
        message: next.message ?? opts.message,
        content: next.content,
        encoding: next.encoding,
        sha: current?.sha,
        maxAttempts: 1,
      });
      return { ...result, written: true };
    } catch (err) {
      if (attempt >= maxAttempts || !isGitHubContentsShaConflict(err)) {
        throw err;
      }
      opts.onConflict?.();
    }
  }

  throw new Error("github_contents_update_retry_exhausted");
}
