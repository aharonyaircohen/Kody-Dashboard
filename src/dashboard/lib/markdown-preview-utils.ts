import { slugifyTitle } from "./slug";

export type MarkdownCalloutKind =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution";

const calloutPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export function extractCodeLanguage(className?: string): string | null {
  const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? "");
  return match?.[1]?.toLowerCase() ?? null;
}

export function detectCalloutKind(text: string): MarkdownCalloutKind | null {
  const match = calloutPattern.exec(text);
  return match ? (match[1].toLowerCase() as MarkdownCalloutKind) : null;
}

export function stripCalloutMarker(text: string): string {
  return text.replace(calloutPattern, "");
}

export function slugifyHeading(text: string): string {
  return slugifyTitle(text.replace(/[`*_~'’]/g, ""), {
    fallback: "section",
    allowUnderscore: false,
  });
}
