/**
 * @fileType utility
 * @domain kody
 * @pattern activity-action-log
 * @ai-summary In-memory hot tier for the dashboard audit trail. A bounded
 *   ring buffer per serverless instance: instant reads, zero GitHub budget.
 *   The durable, cross-instance source of truth lives in a manifest issue
 *   (see `audit-store.ts`); `recordAudit` (see `audit.ts`) writes to both.
 *   This file owns only the shared `AuditEvent` shape + the in-memory ring,
 *   so it stays dependency-free and safe to import from anywhere.
 */

export type AuditOutcome = "ok" | "error" | "denied";

/** Where the action originated. `user` = a human via the dashboard UI. */
export type AuditActorType =
  | "user"
  | "scheduler"
  | "engine"
  | "webhook"
  | "system";

export interface AuditEvent {
  id: string;
  /** Server clock, ISO. */
  at: string;
  /** Coarse verb, e.g. "agentResponsibility.run", "task.action", "vault.write". */
  type: string;
  /** What was acted on, e.g. "#1587", "changelog-verify", a secret name. */
  target: string;
  /** Who did it — the token-resolved GitHub login when known, else "unknown". */
  actor: string;
  /** Repo the action applies to (`owner/name`), when known. */
  repo: string | null;
  /** Optional one-line extra context (the specific sub-action, outcome). */
  detail: string | null;

  // ── Richer audit fields (optional; populated by `recordAudit`) ──────────
  /** Classifies the actor — defaults to "user" for dashboard actions. */
  actorType?: AuditActorType;
  /** AgentResponsibility slug, when the action targets or is performed by a agentResponsibility. */
  agentResponsibility?: string | null;
  /** Agent (agentIdentity) slug that executed, when known. */
  agent?: string | null;
  /** Coarse result of the action. Defaults to "ok". */
  outcome?: AuditOutcome;
  /** Deep link to the acted-on resource (issue/PR/run URL), when known. */
  resourceUrl?: string | null;
  /** Which surface produced the event. */
  source?: "dashboard" | "engine";
}

/**
 * Back-compat alias: the original ring-buffer entry type. `AuditEvent` is a
 * superset, so existing readers (ActivityPage, the /activity/log route)
 * keep compiling unchanged.
 */
export type ActionLogEntry = AuditEvent;

const MAX_ENTRIES = 500;
const buffer: AuditEvent[] = [];

/**
 * Push a fully-formed audit event onto the in-memory ring. Used by the
 * durable orchestrator (`recordAudit`) and the legacy `recordAction` shim.
 * Never throws — a logging failure must never break the observed action.
 */
export function pushAuditEntry(event: AuditEvent): void {
  try {
    buffer.push(event);
    if (buffer.length > MAX_ENTRIES) {
      buffer.splice(0, buffer.length - MAX_ENTRIES);
    }
  } catch {
    /* swallow */
  }
}

/** Mint a reasonably-unique, time-sortable id for an audit event. */
export function newAuditId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record a dashboard-native action into the in-memory ring only (no durable
 * persistence, no actor resolution). Fire-and-forget, sync, never throws.
 *
 * Prefer `recordAudit(req, …)` (see `audit.ts`) for new call sites — it adds
 * a verified actor and durable cross-instance persistence. This shim remains
 * for callers that have no request in scope.
 */
export function recordAction(input: {
  type: string;
  target: string;
  actor?: string | null;
  repo?: string | null;
  detail?: string | null;
}): void {
  pushAuditEntry({
    id: newAuditId(),
    at: new Date().toISOString(),
    type: input.type,
    target: input.target,
    actor: input.actor?.trim() || "unknown",
    repo: input.repo?.trim() || null,
    detail: input.detail?.trim() || null,
    actorType: "user",
    outcome: "ok",
    source: "dashboard",
  });
}

/** Newest-first snapshot of the in-memory ring on this instance. */
export function getActionLog(): AuditEvent[] {
  return [...buffer].reverse();
}
