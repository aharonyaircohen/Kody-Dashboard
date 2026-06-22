export type AgentResponsibilityOutputKind = "run" | "report";

export const DEFAULT_DUTY_OUTPUT_KIND: AgentResponsibilityOutputKind = "run";
export const FALLBACK_REPORT_SLUG = "agentresponsibility-report";

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

export function buildAgentResponsibilityWritesTo(
  outputKind: AgentResponsibilityOutputKind,
  reportSlug: string,
): string[] {
  return outputKind === "report" ? [normalizeReportSlug(reportSlug)] : [];
}

export function agentResponsibilityOutputFromWritesTo(
  writesTo: string[] | null | undefined,
): {
  outputKind: AgentResponsibilityOutputKind;
  reportSlug: string;
} {
  const firstReport = writesTo?.find((value) => value.trim().length > 0);
  return {
    outputKind: firstReport ? "report" : "run",
    reportSlug: normalizeReportSlug(firstReport ?? FALLBACK_REPORT_SLUG),
  };
}

export function buildDefaultAgentResponsibilityBody(
  outputKind: AgentResponsibilityOutputKind,
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
