/**
 * @fileType util
 * @domain preview
 * @pattern upload-context
 * @ai-summary Browser-side summarizer for uploaded static previews. It keeps a
 * small, non-secret outline of HTML/text uploads with the preview environment
 * so chat can understand the page without waiting on the inspector extension.
 */
"use client";

import type { PreviewUploadContext } from "@dashboard/lib/preview-environments";

const MAX_TEXT_PREVIEW = 1500;
const MAX_OUTLINE = 3000;
const READABLE_EXT_RE =
  /\.(html?|xhtml|txt|md|markdown|json|csv|tsv|xml|svg)$/i;

function cleanText(value: string, max: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function appendLine(lines: string[], line: string): boolean {
  const current = lines.join("\n").length;
  if (current + line.length + 1 > MAX_OUTLINE) return false;
  lines.push(line);
  return true;
}

function describeElement(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const role = el.getAttribute("role");
  const rolePart = role ? `[role=${role}]` : "";
  const attrs: string[] = [];

  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href) attrs.push(`href="${href.slice(0, 80)}"`);
  } else if (["input", "textarea", "select"].includes(tag)) {
    const type = el.getAttribute("type") || tag;
    attrs.push(`type="${type}"`);
    const label =
      el.getAttribute("placeholder") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("name");
    if (label) attrs.push(`label="${cleanText(label, 80)}"`);
  }

  const text = cleanText(el.textContent || "", 120);
  const head = `${tag}${id}${rolePart}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (!text && attrs.length === 0 && !role) return null;
  return text ? `${head}: ${text}` : head;
}

function htmlOutline(doc: Document): string {
  const selector = [
    "h1",
    "h2",
    "h3",
    "h4",
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "label",
    "nav",
    "main",
    "header",
    "footer",
    "section",
    "article",
    "form",
    "summary",
    "[role]",
  ].join(",");
  const lines: string[] = [];
  for (const el of Array.from(doc.body?.querySelectorAll(selector) ?? [])) {
    if (
      ["script", "style", "noscript", "svg"].includes(el.tagName.toLowerCase())
    ) {
      continue;
    }
    const line = describeElement(el);
    if (line && !appendLine(lines, line)) break;
  }
  return lines.join("\n");
}

function isReadableUpload(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/xhtml+xml" ||
    mime === "image/svg+xml" ||
    READABLE_EXT_RE.test(file.name || "")
  );
}

function looksLikeHtml(file: File, source: string): boolean {
  const mime = (file.type || "").toLowerCase();
  return (
    mime.includes("html") ||
    /\.(html?|xhtml)$/i.test(file.name || "") ||
    /^\s*<!doctype\s+html/i.test(source) ||
    /^\s*<html[\s>]/i.test(source)
  );
}

export async function createUploadContext(
  file: File,
): Promise<PreviewUploadContext> {
  const base: PreviewUploadContext = {
    name: file.name || "upload",
    mimeType: file.type || undefined,
    size: file.size,
  };

  if (!isReadableUpload(file)) return base;

  try {
    const source = await file.text();
    if (looksLikeHtml(file, source) && typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(source, "text/html");
      const title = cleanText(doc.title || "", 200);
      const outline = htmlOutline(doc);
      const textPreview = cleanText(
        doc.body?.textContent || "",
        MAX_TEXT_PREVIEW,
      );
      return {
        ...base,
        ...(title ? { title } : {}),
        ...(outline ? { outline } : {}),
        ...(textPreview ? { textPreview } : {}),
      };
    }

    const textPreview = cleanText(source, MAX_TEXT_PREVIEW);
    return {
      ...base,
      ...(textPreview ? { textPreview } : {}),
    };
  } catch {
    return base;
  }
}
