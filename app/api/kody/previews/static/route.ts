/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern static-previews-api
 *
 * Upload-and-serve previews: take a single static file (HTML, PDF, image…)
 * and host it on a Fly preview with NO build. The file is injected into a
 * stock static-server machine via Fly's `config.files` (see
 * `static-preview.ts`), so it's live in seconds.
 *
 *   POST   /api/kody/previews/static  (multipart form, field `file`) —
 *          upload a file, boot a preview, return `{ id, url }`. The caller
 *          (Preview workspace) records it as a named environment, which is
 *          the single source of truth — no separate ledger here.
 *   DELETE /api/kody/previews/static  { id } — destroy the Fly app for an
 *          uploaded preview. Idempotent.
 *
 * Repo comes from the connected-repo auth context (per-repo Fly infra), not
 * the body. Fly billing uses that repo's own vault `FLY_API_TOKEN` via
 * `resolvePreviewConfigForOctokit`.
 */

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import { destroyPreview } from "@dashboard/lib/previews/preview-lifecycle";
import {
  createStaticPreview,
  type StaticPreviewFile,
} from "@dashboard/lib/previews/static-preview";

export const runtime = "nodejs";

/** Files are inlined into the Fly machine config; keep them modest so the
 *  create-machine request stays well within limits. A self-contained HTML
 *  page is comfortably under this. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 50;

/** Keep only filesystem-safe characters; drop any path component. */
function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 100) : "file";
}

function isHtmlName(name: string): boolean {
  return /\.html?$/i.test(name);
}

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

/** Content sniffs — fallback when the filename has no/with a misleading
 *  extension. The browser-supplied MIME is checked first by the caller. */
function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

function looksLikeHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString("utf8").trim().toLowerCase();
  return /^<(!doctype html|html[\s>]|head[\s>]|body[\s>])/.test(head);
}

/** Tiny landing page that forwards to a non-HTML upload (image, …), served
 *  with its correct content-type by the static server. Images render fine in
 *  the (sandboxed) preview iframe; only PDFs need the viewer below. */
function redirectIndexHtml(fileName: string): string {
  const url = `./${encodeURI(fileName)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${url}"><title>${fileName}</title></head><body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:2rem"><a style="color:#7cc4ff" href="${url}">Open ${fileName}</a></body></html>`;
}

/** PDF.js pinned via CDN — renders PDFs to <canvas>, which works inside the
 *  dashboard's sandboxed preview iframe where the browser's native PDF plugin
 *  is blocked (a redirect to the raw .pdf just shows blank there). */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function uniquePath(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let next = `${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}

function fileListIndexHtml(files: StaticPreviewFile[]): string {
  const items = files
    .filter((file) => file.path !== "index.html")
    .map((file) => {
      const href = `./${encodeURI(file.path)}`;
      const label = escapeHtml(file.path);
      return `<li><a href="${href}">${label}</a></li>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Uploaded files</title><style>body{margin:0;background:#0b0b0b;color:#eee;font-family:system-ui,sans-serif;padding:2rem}a{color:#7cc4ff}li{margin:.5rem 0}</style></head><body><h1>Uploaded files</h1><ul>${items}</ul></body></html>`;
}

const PDFJS_VERSION = "3.11.174";

function pdfViewerHtml(fileName: string): string {
  const src = `./${encodeURI(fileName)}`;
  const lib = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
  const worker = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fileName}</title>
<style>
  html,body{margin:0;height:100%;background:#525659}
  #pages{padding:12px 0}
  canvas{display:block;margin:0 auto 12px;max-width:100%;box-shadow:0 1px 6px rgba(0,0,0,.5)}
  #msg{color:#eee;font-family:system-ui,sans-serif;padding:1.5rem;text-align:center}
  #msg a{color:#7cc4ff}
</style></head>
<body>
<div id="pages"></div>
<div id="msg">Loading ${fileName}…</div>
<script src="${lib}"></script>
<script>
(function(){
  var msg=document.getElementById('msg'), pages=document.getElementById('pages');
  if(!window.pdfjsLib){msg.innerHTML='<a href="${src}">Open ${fileName}</a>';return;}
  pdfjsLib.GlobalWorkerOptions.workerSrc='${worker}';
  pdfjsLib.getDocument('${src}').promise.then(function(pdf){
    msg.style.display='none';
    var n=1;
    (function next(){
      if(n>pdf.numPages)return;
      pdf.getPage(n).then(function(page){
        var vp=page.getViewport({scale:1.5});
        var c=document.createElement('canvas');
        c.width=vp.width;c.height=vp.height;
        pages.appendChild(c);
        return page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise
          .then(function(){n++;next();});
      });
    })();
  }).catch(function(){
    msg.innerHTML='Could not render this PDF. <a href="${src}">Open it directly</a>.';
  });
})();
</script>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message:
          "FLY_API_TOKEN not in this repo's secrets vault and no FLY_API_TOKEN env fallback.",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const uploadedFiles = form
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);
  if (uploadedFiles.length === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (uploadedFiles.length > MAX_FILES) {
    return NextResponse.json(
      {
        error: "too_many_files",
        message: `Too many files (${MAX_FILES} max)`,
      },
      { status: 413 },
    );
  }

  const uploads = await Promise.all(
    uploadedFiles.map(async (file) => ({
      file,
      raw: Buffer.from(await file.arrayBuffer()),
      originalName: (file.name || "upload.html").trim(),
    })),
  );
  const empty = uploads.find((upload) => upload.raw.length === 0);
  if (empty) {
    return NextResponse.json(
      {
        error: "empty_file",
        message: `${empty.originalName} is empty`,
      },
      { status: 400 },
    );
  }
  const tooLarge = uploads.find((upload) => upload.raw.length > MAX_BYTES);
  if (tooLarge) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `${tooLarge.originalName} is too large (5 MB max)`,
      },
      { status: 413 },
    );
  }
  const totalBytes = uploads.reduce(
    (sum, upload) => sum + upload.raw.length,
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: "files_too_large",
        message: "Files are too large together (10 MB max)",
      },
      { status: 413 },
    );
  }

  const asB64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  let files: StaticPreviewFile[];
  const previewName =
    uploads.length === 1
      ? uploads[0]!.originalName
      : `${uploads[0]!.originalName} + ${uploads.length - 1} ${
          uploads.length === 2 ? "file" : "files"
        }`;

  if (uploads.length === 1) {
    const upload = uploads[0]!;
    const safeName = sanitizeName(upload.originalName);
    const mime = (upload.file.type || "").toLowerCase();

    // Decide the type from three signals: filename extension, the browser's
    // MIME, then the file's own bytes (magic number / leading markup). PDF wins
    // ties (a file can't be both). This way an extension-less PDF or HTML still
    // previews correctly.
    const isPdf =
      isPdfName(safeName) ||
      mime === "application/pdf" ||
      looksLikePdf(upload.raw);
    const isHtml =
      !isPdf &&
      (isHtmlName(safeName) ||
        mime.startsWith("text/html") ||
        looksLikeHtml(upload.raw));

    // HTML → serve as the index itself. PDF → an index that renders it with
    // PDF.js (the sandboxed preview iframe blocks the native PDF plugin).
    // Anything else (images, …) → serve under its name + a redirecting index.
    if (isHtml) {
      files = [
        { path: "index.html", contentBase64: upload.raw.toString("base64") },
      ];
    } else if (isPdf) {
      // Ensure a .pdf name so the "open directly" link gets the right
      // content-type (PDF.js itself sniffs bytes, so it doesn't care).
      const pdfName = isPdfName(safeName) ? safeName : `${safeName}.pdf`;
      files = [
        { path: pdfName, contentBase64: upload.raw.toString("base64") },
        { path: "index.html", contentBase64: asB64(pdfViewerHtml(pdfName)) },
      ];
    } else {
      files = [
        { path: safeName, contentBase64: upload.raw.toString("base64") },
        {
          path: "index.html",
          contentBase64: asB64(redirectIndexHtml(safeName)),
        },
      ];
    }
  } else {
    const used = new Set<string>();
    files = uploads.map((upload) => {
      const safeName = sanitizeName(upload.originalName);
      const path = uniquePath(
        /^index\.html?$/i.test(safeName) ? "index.html" : safeName,
        used,
      );
      return { path, contentBase64: upload.raw.toString("base64") };
    });

    if (!files.some((file) => file.path === "index.html")) {
      files.push({
        path: "index.html",
        contentBase64: asB64(fileListIndexHtml(files)),
      });
    }
  }

  const staticId = randomUUID().slice(0, 8);

  try {
    const info = await createStaticPreview(
      { repo: `${auth.owner}/${auth.repo}`, staticId, files },
      cfg,
    );
    return NextResponse.json(
      { id: staticId, name: previewName, url: info.url, state: info.state },
      { status: 201 },
    );
  } catch (err) {
    logger.error({ err, staticId }, "static-preview: create failed");
    return NextResponse.json(
      { error: "create_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id =
    body && typeof body === "object" && "id" in body
      ? String((body as { id: unknown }).id)
      : "";
  if (!id) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }

  try {
    await destroyPreview(
      { repo: `${auth.owner}/${auth.repo}`, staticId: id },
      cfg,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "static-preview: destroy failed");
    return NextResponse.json(
      { error: "destroy_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
