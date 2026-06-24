/**
 * @fileType utility
 * @domain kody
 * @pattern report-suggested-actions
 * @ai-summary Small frontmatter parser for report `suggestedActions`.
 *   Reports remain markdown files; actions are simple scalar YAML-ish rows.
 */

export const REPORT_SUGGESTED_ACTION_TYPES = [
  "dispatch",
  "create-task",
  "dismiss",
] as const;

export type ReportSuggestedActionType =
  (typeof REPORT_SUGGESTED_ACTION_TYPES)[number];

export interface ReportSuggestedAction {
  id: string;
  type: ReportSuggestedActionType;
  label: string;
  reason?: string;
  agentAction?: string;
  target?: number;
  title?: string;
  body?: string;
  labels?: string[];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseObjectList(
  frontmatter: string | null,
  key: string,
): Array<Record<string, string>> {
  if (!frontmatter) return [];
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*$`).test(line),
  );
  if (start < 0) return [];

  const items: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;

    const firstKey = line.match(/^\s{2}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (firstKey) {
      current = { [firstKey[1]!]: unquote(firstKey[2] ?? "") };
      items.push(current);
      continue;
    }

    const nextKey = line.match(/^\s{4}([A-Za-z][\w-]*):\s*(.*)$/);
    if (current && nextKey) {
      current[nextKey[1]!] = unquote(nextKey[2] ?? "");
    }
  }

  return items;
}

function asActionType(value: string): ReportSuggestedActionType | null {
  return (REPORT_SUGGESTED_ACTION_TYPES as readonly string[]).includes(value)
    ? (value as ReportSuggestedActionType)
    : null;
}

function parseLabels(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const labels = value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return labels.length > 0 ? labels : undefined;
}

function parseTarget(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function parseReportSuggestedActions(
  frontmatter: string | null,
): ReportSuggestedAction[] {
  return parseObjectList(frontmatter, "suggestedActions").flatMap((raw) => {
    const type = raw.type ? asActionType(raw.type) : null;
    if (!raw.id || !type || !raw.label) return [];
    return [
      {
        id: raw.id,
        type,
        label: raw.label,
        ...(raw.reason ? { reason: raw.reason } : {}),
        ...(raw.agentAction ? { agentAction: raw.agentAction } : {}),
        ...(parseTarget(raw.target) ? { target: parseTarget(raw.target) } : {}),
        ...(raw.title ? { title: raw.title } : {}),
        ...(raw.body ? { body: raw.body } : {}),
        ...(parseLabels(raw.labels) ? { labels: parseLabels(raw.labels) } : {}),
      },
    ];
  });
}
