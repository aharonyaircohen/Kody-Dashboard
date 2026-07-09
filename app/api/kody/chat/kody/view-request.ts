/**
 * @fileType utility
 * @domain kody
 * @pattern prompt-intent-parser
 * @ai-summary Parses direct "show <purpose> UI" requests so Kody chat can
 *   force the show_view tool instead of letting the model answer in prose.
 */

import { slugifyTitle } from "@dashboard/lib/slug";

export interface ExplicitViewRequest {
  purpose: string;
  title?: string;
}

function normalizePurpose(raw: string): string {
  return slugifyTitle(raw);
}

function cleanTitle(raw: string | undefined): string | undefined {
  const title = raw
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  return title && title.length > 0 ? title : undefined;
}

export function parseExplicitViewRequest(
  text: string | null | undefined,
): ExplicitViewRequest | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const match =
    /^show\s+([a-z0-9][a-z0-9_\-\s]{0,80}?)\s+ui\s*:?\s*(.*)$/is.exec(trimmed);
  if (!match) return null;
  const purpose = normalizePurpose(match[1]);
  if (!purpose) return null;
  const title = cleanTitle(match[2]);
  return {
    purpose,
    ...(title ? { title } : {}),
  };
}

export function buildExplicitViewRequestInstruction(
  request: ExplicitViewRequest,
): string {
  const data: Record<string, unknown> = {};
  if (request.title) data.title = request.title;
  return [
    "The latest user message is an explicit UI render request.",
    "Your next action must be a show_view tool call.",
    `Use purpose: ${request.purpose}.`,
    `Use data: ${JSON.stringify(data)}.`,
    "Do not answer in prose before the tool call.",
  ]
    .filter(Boolean)
    .join("\n");
}
