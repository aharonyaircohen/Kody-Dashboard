/**
 * @fileType api-endpoint
 * @domain preview
 * @pattern repo-backed-static-view-server
 * @ai-summary Serves static resources stored in connected consumer repo
 * under `.kody/views/<view-id>/...`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth } from "@dashboard/lib/auth";
import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resolveStateRepo, stateRepoPath } from "@dashboard/lib/state-repo";
import { verifyRepoViewToken } from "@dashboard/lib/view-token";

export const runtime = "nodejs";

const VIEW_ROOT = "views";
const VIEW_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN_SEGMENT = "_t";
const GITHUB_API_VERSION = "2022-11-28";

const HTML_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-downloads",
  "default-src 'self' data: blob: http: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:",
  "style-src 'self' 'unsafe-inline' http: https:",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data: http: https:",
  "connect-src 'self' data: blob: http: https:",
  "worker-src blob: http: https:",
].join("; ");

function normalizeResourcePath(input: string): string | null {
  const clean = input.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return "index.html";
  if (
    parts.some(
      (part) =>
        part === "." ||
        part === ".." ||
        part.includes("\0") ||
        part.length > 160,
    )
  ) {
    return null;
  }
  const path = parts.join("/");
  if (path.length > 500) return null;
  return path;
}

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "json":
    case "map":
      return "application/json; charset=utf-8";
    case "txt":
    case "md":
      return "text/plain; charset=utf-8";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "ico":
      return "image/x-icon";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "csv":
      return "text/csv; charset=utf-8";
    case "xml":
      return "application/xml; charset=utf-8";
    case "wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

function filenameFor(path: string): string {
  return (path.split("/").pop() || "file").replace(/["\r\n]/g, "_");
}

function baseHeaders(path: string): Headers {
  const type = contentTypeFor(path);
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `inline; filename="${filenameFor(path)}"`,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
      "Accept-Ranges, Content-Length, Content-Range",
    "Accept-Ranges": "bytes",
  });
  if (type.startsWith("text/html")) {
    headers.set("Content-Security-Policy", HTML_CSP);
  }
  return headers;
}

function responseForBody(
  body: Buffer,
  path: string,
  rangeHeader: string | null,
): NextResponse {
  const headers = baseHeaders(path);
  headers.set("Content-Length", String(body.length));
  if (!rangeHeader) {
    return new NextResponse(new Uint8Array(body), { status: 200, headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return new NextResponse(new Uint8Array(body), { status: 200, headers });
  }

  const startRaw = match[1];
  const endRaw = match[2];
  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : body.length - 1;

  if (!startRaw && endRaw) {
    const suffixLength = Number(endRaw);
    start = Math.max(0, body.length - suffixLength);
    end = body.length - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= body.length
  ) {
    headers.set("Content-Range", `bytes */${body.length}`);
    return new NextResponse(null, { status: 416, headers });
  }

  end = Math.min(end, body.length - 1);
  const chunk = body.subarray(start, end + 1);
  headers.set("Content-Length", String(chunk.length));
  headers.set("Content-Range", `bytes ${start}-${end}/${body.length}`);
  return new NextResponse(new Uint8Array(chunk), { status: 206, headers });
}

type ResolvedAccess =
  | {
      ok: true;
      owner: string;
      repo: string;
      token: string;
      viewId: string;
      resourcePath: string;
    }
  | { ok: false; response: NextResponse };

function resolveAccess(req: NextRequest, segments: string[]): ResolvedAccess {
  if (segments[0] === TOKEN_SEGMENT) {
    const ticket = segments[1];
    const viewId = segments[2];
    if (!ticket || !viewId || !VIEW_ID_RE.test(viewId)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "invalid_view_path" },
          { status: 400 },
        ),
      };
    }

    try {
      const claims = verifyRepoViewToken(ticket);
      if (claims.viewId !== viewId) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "view_ticket_mismatch" },
            { status: 403 },
          ),
        };
      }

      const resourcePath = normalizeResourcePath(segments.slice(3).join("/"));
      if (!resourcePath) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "invalid_resource_path" },
            { status: 400 },
          ),
        };
      }

      return {
        ok: true,
        owner: claims.owner,
        repo: claims.repo,
        token: claims.githubToken,
        viewId,
        resourcePath,
      };
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "invalid_view_ticket" },
          { status: 401 },
        ),
      };
    }
  }

  const auth = getRequestAuth(req);
  const viewId = segments[0];
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "view_ticket_required" },
        { status: 401 },
      ),
    };
  }
  if (!viewId || !VIEW_ID_RE.test(viewId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid_view_path" },
        { status: 400 },
      ),
    };
  }

  const resourcePath = normalizeResourcePath(segments.slice(1).join("/"));
  if (!resourcePath) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid_resource_path" },
        { status: 400 },
      ),
    };
  }
  return {
    ok: true,
    owner: auth.owner,
    repo: auth.repo,
    token: auth.token,
    viewId,
    resourcePath,
  };
}

function encodeGitHubPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchRepoFile(input: {
  owner: string;
  repo: string;
  token: string;
  repoPath: string;
}): Promise<Buffer | null> {
  const background = await resolveBackgroundToken(input.owner, input.repo);
  const readToken = background?.token ?? input.token;
  const octokit = createUserOctokit(readToken);
  const target = await resolveStateRepo(octokit, input.owner, input.repo);
  const repoPath = stateRepoPath(target, input.repoPath);
  const url = `https://api.github.com/repos/${encodeURIComponent(
    target.owner,
  )}/${encodeURIComponent(target.repo)}/contents/${encodeGitHubPath(repoPath)}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${readToken}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub content read failed (${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path: segments } = await params;
  const access = resolveAccess(req, segments ?? []);
  if (!access.ok) return access.response;

  const resourcePath = access.resourcePath;
  if (!resourcePath) {
    return NextResponse.json(
      { error: "invalid_resource_path" },
      { status: 400 },
    );
  }

  const repoPath = `${VIEW_ROOT}/${access.viewId}/${resourcePath}`;
  try {
    const body = await fetchRepoFile({
      owner: access.owner,
      repo: access.repo,
      token: access.token,
      repoPath,
    });
    if (!body) {
      return NextResponse.json(
        { error: "view_file_not_found" },
        { status: 404 },
      );
    }
    return responseForBody(body, resourcePath, req.headers.get("range"));
  } catch (err) {
    logger.error(
      {
        err,
        owner: access.owner,
        repo: access.repo,
        viewId: access.viewId,
        resourcePath,
      },
      "views: serve failed",
    );
    return NextResponse.json(
      { error: "view_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  const headers = baseHeaders("options.txt");
  return new NextResponse(null, { status: 204, headers });
}
