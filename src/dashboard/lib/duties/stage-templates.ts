/**
 * @fileType util
 * @domain duties
 * @pattern duty-stage-templates
 * @ai-summary Built-in progress templates for duties. Users pick a friendly
 *   workflow shape; the engine/dashboard can map it to hidden runtime state.
 */

export const DUTY_STAGE_TEMPLATES = [
  {
    slug: "simple-check",
    label: "Simple check",
    description: "Use when the duty only needs to run and finish.",
    states: ["idle", "running", "done", "failed"],
  },
  {
    slug: "report-refresh",
    label: "Report refresh",
    description: "Use when the duty updates a report or result file.",
    states: ["idle", "refreshing", "updated", "failed"],
  },
  {
    slug: "sweep",
    label: "Scan sweep",
    description: "Use when the duty scans many things and records findings.",
    states: ["idle", "scanning", "issues-opened", "done", "failed"],
  },
  {
    slug: "approval-gate",
    label: "Approval gate",
    description: "Use when the duty waits for review, then approves or blocks.",
    states: ["waiting", "reviewing", "approved", "blocked"],
  },
  {
    slug: "review-loop",
    label: "Repeated review",
    description: "Use when the duty reviews items again and again over time.",
    states: ["idle", "reviewing", "needs-action", "done", "failed"],
  },
] as const;

export type DutyStageTemplateSlug = (typeof DUTY_STAGE_TEMPLATES)[number]["slug"];

export const DEFAULT_DUTY_STAGE_TEMPLATE: DutyStageTemplateSlug =
  "simple-check";

export const DUTY_STAGE_TEMPLATE_SLUGS = DUTY_STAGE_TEMPLATES.map(
  (template) => template.slug,
) as [DutyStageTemplateSlug, ...DutyStageTemplateSlug[]];

const DUTY_STAGE_TEMPLATE_SLUG_SET = new Set<string>(
  DUTY_STAGE_TEMPLATE_SLUGS,
);

export function isDutyStageTemplateSlug(
  value: unknown,
): value is DutyStageTemplateSlug {
  return typeof value === "string" && DUTY_STAGE_TEMPLATE_SLUG_SET.has(value);
}

export function getDutyStageTemplate(slug: DutyStageTemplateSlug | null) {
  return (
    DUTY_STAGE_TEMPLATES.find((template) => template.slug === slug) ?? null
  );
}
