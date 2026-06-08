/**
 * @fileType utility
 * @domain docs
 * @pattern github-contents
 * @ai-summary Read documentation files (README.md + docs/*.md) in the target
 *   GitHub repo via the Contents API. Read-only; docs are maintained in PRs.
 */

import { Octokit } from "@octokit/rest";

export const DOCS_FOLDER = "docs";
export const README_PATH = "README.md";

interface RawContents {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  html_url?: string;
  name?: string;
}

export interface DocFile {
  name: string;
  path: string;
  content: string;
  sha: string | null;
  htmlUrl: string | null;
}

export interface DocManifestEntry {
  name: string;
  path: string;
  htmlUrl: string | null;
}

export interface DocsManifest {
  files: DocManifestEntry[];
}

export function isAllowedDocPath(path: string): boolean {
  if (path.includes("\\") || path.startsWith("/") || path.includes("..")) {
    return false;
  }
  if (path === README_PATH) return true;
  return /^docs\/[^/]+\.md$/i.test(path);
}

/**
 * List README.md + docs/*.md in the repo. Returns entries with name, path,
 * and htmlUrl but no content (lightweight listing for the selector sidebar).
 */
export async function listDocs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<DocsManifest> {
  const files: DocManifestEntry[] = [];

  // Always include README.md
  try {
    const readme = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: README_PATH,
      headers: { "If-None-Match": "" },
    });
    const data = readme.data as RawContents | RawContents[];
    if (!Array.isArray(data) && data.type === "file") {
      files.push({
        name: "README.md",
        path: README_PATH,
        htmlUrl: data.html_url ?? null,
      });
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 404 is fine — README.md simply doesn't exist
    if (status !== 404) throw err;
  }

  // List docs/*.md
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: DOCS_FOLDER,
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContents | RawContents[];
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === "file" && item.name && item.name.endsWith(".md")) {
          files.push({
            name: item.name,
            path: `${DOCS_FOLDER}/${item.name}`,
            htmlUrl: item.html_url ?? null,
          });
        }
      }
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 404 is fine — docs/ folder simply doesn't exist
    if (status !== 404) throw err;
  }

  return { files };
}

/**
 * Read a single doc file by path.
 */
export async function readDoc(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<DocFile> {
  if (!isAllowedDocPath(path)) {
    throw new Error("invalid_doc_path");
  }

  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContents | RawContents[];
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      return { name: path, path, content: "", sha: null, htmlUrl: null };
    }
    const buf = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    );
    return {
      name: path,
      path,
      content: buf.toString("utf8"),
      sha: data.sha ?? null,
      htmlUrl: data.html_url ?? null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { name: path, path, content: "", sha: null, htmlUrl: null };
    }
    throw err;
  }
}
