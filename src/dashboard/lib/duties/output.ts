export type DutyOutputKind = "run" | "report";

export const DEFAULT_DUTY_OUTPUT_KIND: DutyOutputKind = "run";
export const FALLBACK_REPORT_SLUG = "duty-report";

export function normalizeReportSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return slug || FALLBACK_REPORT_SLUG;
}

export function defaultReportSlug(action: string, title: string): string {
  return normalizeReportSlug(action.trim() || title.trim());
}

export function buildDutyWritesTo(
  outputKind: DutyOutputKind,
  reportSlug: string,
): string[] {
  return outputKind === "report" ? [normalizeReportSlug(reportSlug)] : [];
}

export function dutyOutputFromWritesTo(writesTo: string[] | null | undefined): {
  outputKind: DutyOutputKind;
  reportSlug: string;
} {
  const firstReport = writesTo?.find((value) => value.trim().length > 0);
  return {
    outputKind: firstReport ? "report" : "run",
    reportSlug: normalizeReportSlug(firstReport ?? FALLBACK_REPORT_SLUG),
  };
}

export function buildDefaultDutyBody(
  outputKind: DutyOutputKind,
  reportSlug: string,
): string {
  const output =
    outputKind === "report"
      ? `\n## Output\n\nRefresh \`.kody/reports/${normalizeReportSlug(reportSlug)}.md\`.\n`
      : "";

  return `## Job

${output}
## Allowed Commands


## Restrictions

`;
}
