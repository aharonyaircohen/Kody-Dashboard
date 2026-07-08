/**
 * @fileType shared-util
 * @domain chat
 * @pattern text-backend-attachment-guard
 *
 * Some chat backends only accept plain string turns. Small attachments can
 * still ride as data URLs, but large screenshots must not be stuffed into
 * prompt text because providers count that base64 against the context window.
 */

export const MAX_TEXT_BACKEND_ATTACHMENT_DATA_CHARS = 24_000;

interface TextBackendAttachment {
  kind: "image" | "file";
  data: string;
  mimeType?: string;
  name?: string;
  sizeLabel?: string;
  maxDataChars?: number;
}

export function dataUrlForTextAttachment(
  data: string,
  mimeType = "application/octet-stream",
): string {
  if (/^data:[^;,]+;base64,/s.test(data)) return data;
  return `data:${mimeType};base64,${data}`;
}

export function formatAttachmentForTextBackend({
  kind,
  data,
  mimeType,
  name,
  sizeLabel,
  maxDataChars = MAX_TEXT_BACKEND_ATTACHMENT_DATA_CHARS,
}: TextBackendAttachment): string {
  const labelKind = kind === "image" ? "Image" : "File";
  const labelDetails = [mimeType, sizeLabel].filter(Boolean).join(", ");
  const label = name
    ? `[${labelKind}: ${name}${labelDetails ? ` (${labelDetails})` : ""}]`
    : `[${labelKind}${labelDetails ? `: ${labelDetails}` : ""}]`;
  const dataUrl = dataUrlForTextAttachment(data, mimeType);
  if (dataUrl.length <= maxDataChars) return `${label}\n${dataUrl}`;

  return [
    label,
    `[Attachment data omitted: ${labelKind.toLowerCase()} data is too large for this text-only chat path and would exceed the model context window.]`,
    "Use a vision-capable Kody model, Brain, or a smaller crop if the image itself must be inspected.",
  ].join("\n");
}
