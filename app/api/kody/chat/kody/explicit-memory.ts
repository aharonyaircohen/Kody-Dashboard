import { createHash } from "node:crypto";

import type { MemoryType } from "@dashboard/lib/memory-files";

export interface ExplicitMemoryDraft {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

const EXPLICIT_MEMORY_RE =
  /^\s*(?:please\s+)?(?:remember|store\s+this|save\s+this(?:\s+for\s+later)?|save\s+that(?:\s+for\s+later)?)\s*[:,-]?\s*(.+)$/is;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

function compact(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function hashSuffix(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function titleFromMemory(content: string): string {
  const words = compact(content)
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const title = words.join(" ");
  return title.length >= 3 ? title.slice(0, 80) : "Explicit chat memory";
}

function classifyMemory(content: string): MemoryType {
  const text = content.toLowerCase();
  if (/\b(i am|i'm|my role|my preference|i prefer|call me)\b/.test(text)) {
    return "user";
  }
  if (/\b(linear|grafana|slack|jira|notion|url|https?:\/\/)\b/.test(text)) {
    return "reference";
  }
  if (
    /\b(repo|project|dashboard|kody|workflow|capability|capabilities|implementation|team|deadline)\b/.test(
      text,
    )
  ) {
    return "project";
  }
  return "feedback";
}

export function buildExplicitMemoryDraft(
  messageText: string,
): ExplicitMemoryDraft | null {
  const match = EXPLICIT_MEMORY_RE.exec(messageText);
  if (!match) return null;

  const content = compact(match[1]);
  if (content.length < 5) return null;

  const name = titleFromMemory(content);
  const type = classifyMemory(content);
  const baseId = slugify(name).slice(0, 55) || "explicit-chat-memory";
  const id = `${baseId}-${hashSuffix(content)}`.slice(0, 64);
  const description = compact(content).slice(0, 200);
  const body =
    `${content}\n\n` +
    "**Why:** User explicitly asked Kody to remember this.\n" +
    "**How apply:** Apply this guidance in future Kody Dashboard work unless current repo evidence supersedes it.";

  return {
    id,
    name,
    description,
    type,
    body,
  };
}
