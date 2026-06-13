/**
 * @fileType util
 * @domain chat | preview
 * @pattern preview-context
 * @ai-summary Formats the active Preview workspace environment into a compact
 * chat context block. This is the extension-free fallback: the inspector can
 * still append a live DOM snapshot when available, but uploaded previews carry
 * their own saved outline so the model knows what "this upload/page" means.
 */

import type { PreviewEnvironment } from "@dashboard/lib/preview-environments";

function oneLine(input: string | undefined, max = 240): string | null {
  const cleaned = input?.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function clipBlock(input: string | undefined, max = 3000): string | null {
  const cleaned = input?.trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function formatBytes(bytes: number | undefined): string | null {
  if (!Number.isFinite(bytes) || bytes === undefined || bytes < 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function previewChatContextBlock(
  env: PreviewEnvironment | null | undefined,
): string | null {
  if (!env) return null;

  const upload = env.uploadContext;
  const isUpload = Boolean(env.staticId);
  const lines = [
    `[Preview context - the user is viewing ${
      isUpload ? "an uploaded preview" : "a preview environment"
    } in the Kody Preview workspace. When they say "this page", "here", "the preview", or "the upload", they mean this preview.]`,
    `- Environment: ${oneLine(env.label) ?? "Preview"}`,
    `- Preview URL: ${env.url}`,
  ];

  if (upload) {
    const fileBits = [
      oneLine(upload.name) ?? env.label,
      oneLine(upload.mimeType),
      formatBytes(upload.size),
    ].filter(Boolean);
    lines.push(`- Uploaded file: ${fileBits.join(" | ")}`);
    const title = oneLine(upload.title);
    if (title) lines.push(`- Page title: ${title}`);
    const outline = clipBlock(upload.outline);
    if (outline) {
      lines.push("- Uploaded page outline:");
      lines.push("```");
      lines.push(outline);
      lines.push("```");
    }
    const textPreview = clipBlock(upload.textPreview, 1500);
    if (textPreview) {
      lines.push("- Uploaded page text:");
      lines.push("```");
      lines.push(textPreview);
      lines.push("```");
    }
  }

  return lines.join("\n");
}
