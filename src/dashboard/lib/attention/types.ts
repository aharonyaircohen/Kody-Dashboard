/**
 * @fileType utility
 * @domain kody
 * @pattern attention-model
 * @ai-summary Shared home-page presentation model. Source-specific records
 *   become AttentionItems so the dashboard can answer one operator loop
 *   without making the user think in task/report/health/activity internals.
 */

export type AttentionSource =
  | "task"
  | "ci"
  | "report"
  | "health"
  | "activity"
  | "goal"
  | "brain";

export type AttentionSection = "needs_you" | "running" | "done" | "quiet";

export type AttentionStatus =
  | "blocked"
  | "failed"
  | "waiting"
  | "running"
  | "done"
  | "healthy";

export type AttentionProofKind =
  | "pr"
  | "preview"
  | "trace"
  | "report"
  | "run"
  | "log";

export interface AttentionProof {
  label: string;
  href: string;
  kind: AttentionProofKind;
}

export type AttentionActionKind =
  | "open"
  | "view-proof"
  | "approve"
  | "reject"
  | "dismiss"
  | "retry"
  | "stop"
  | "create-task";

export type AttentionActionVariant = "primary" | "secondary" | "danger";

export interface AttentionAction {
  id: string;
  kind: AttentionActionKind;
  label: string;
  href?: string;
  external?: boolean;
  title?: string;
  variant?: AttentionActionVariant;
  pending?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface AttentionItem {
  id: string;
  source: AttentionSource;
  section: AttentionSection;
  status: AttentionStatus;
  severity: 1 | 2 | 3 | 4 | 5;
  title: string;
  reason: string;
  href?: string;
  owner?: string;
  occurredAt?: string;
  proof?: AttentionProof;
  actions: AttentionAction[];
}
