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
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.length === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", message: "File too large (5 MB max)" },
      { status: 413 },
    );
  }

  const originalName = (file.name || "upload.html").trim();
  const safeName = sanitizeName(originalName);

  // HTML → serve as the index itself. PDF → an index that renders it with
  // PDF.js (the sandboxed preview iframe blocks the native PDF plugin).
  // Anything else (images, …) → serve under its name + a redirecting index.
  let files: StaticPreviewFile[];
  if (isHtmlName(safeName)) {
    files = [{ path: "index.html", contentBase64: raw.toString("base64") }];
  } else {
    const indexHtml = isPdfName(safeName)
      ? pdfViewerHtml(safeName)
      : redirectIndexHtml(safeName);
    files = [
      { path: safeName, contentBase64: raw.toString("base64") },
      {
        path: "index.html",
        contentBase64: Buffer.from(indexHtml, "utf8").toString("base64"),
      },
    ];
  }

  const staticId = randomUUID().slice(0, 8);

  try {
    const info = await createStaticPreview(
      { repo: `${auth.owner}/${auth.repo}`, staticId, files },
      cfg,
    );
    return NextResponse.json(
      { id: staticId, name: originalName, url: info.url, state: info.state },
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
