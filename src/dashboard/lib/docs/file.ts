/**
 * @fileType utility
 * @domain docs
 * @pattern github-contents
 * @ai-summary Read README.md and nested markdown files under docs/ in the
 *   target GitHub repo via the Contents API. Read-only; docs are maintained
 *   in PRs.
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
  path?: string;
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
  type: "file" | "folder";
  htmlUrl: string | null;
}

export interface DocsManifest {
  files: DocManifestEntry[];
}

export function isAllowedDocPath(path: string): boolean {
  if (path.includes("\\") || path.startsWith("/")) {
    return false;
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }
  if (path === README_PATH) return true;
  return /^docs\/.+\.md$/i.test(path);
}

/**
 * List README.md and nested markdown files under docs/. Returns entries with name, path,
 * and htmlUrl but no content (lightweight listing for the selector sidebar).
 */
export async function listDocs(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<DocsManifest> {
  const files: DocManifestEntry[] = [];
  const seenFolders = new Set<string>();

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
        type: "file",
        htmlUrl: data.html_url ?? null,
      });
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 404 is fine — README.md simply doesn't exist
    if (status !== 404) throw err;
  }

  const addFolder = (folderPath: string, htmlUrl: string | null = null) => {
    if (seenFolders.has(folderPath)) return;
    seenFolders.add(folderPath);
    files.push({
      name: folderPath.split("/").pop() ?? folderPath,
      path: folderPath,
      type: "folder",
      htmlUrl,
    });
  };

  const walkDocsFolder = async (folderPath: string) => {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: folderPath,
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContents | RawContents[];
    if (!Array.isArray(data)) return;

    addFolder(folderPath);

    for (const item of data) {
      const itemPath = item.path ?? `${folderPath}/${item.name ?? ""}`;
      if (item.type === "dir" && item.name) {
        addFolder(itemPath, item.html_url ?? null);
        await walkDocsFolder(itemPath);
        continue;
      }
      if (
        item.type === "file" &&
        item.name &&
        item.name.toLowerCase().endsWith(".md") &&
        isAllowedDocPath(itemPath)
      ) {
        files.push({
          name: item.name,
          path: itemPath,
          type: "file",
          htmlUrl: item.html_url ?? null,
        });
      }
    }
  };

  // List docs/**/*.md
  try {
    await walkDocsFolder(DOCS_FOLDER);
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 404 is fine — docs/ folder simply doesn't exist
    if (status !== 404) throw err;
  }

  return { files: sortDocsManifest(files) };
}

function sortDocsManifest(files: DocManifestEntry[]): DocManifestEntry[] {
  return [...files].sort((a, b) => {
    if (a.path === README_PATH) return -1;
    if (b.path === README_PATH) return 1;

    const aParent = a.path.includes("/")
      ? a.path.slice(0, a.path.lastIndexOf("/"))
      : "";
    const bParent = b.path.includes("/")
      ? b.path.slice(0, b.path.lastIndexOf("/"))
      : "";

    if (aParent === bParent && a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });
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
