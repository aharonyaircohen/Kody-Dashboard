/**
 * @fileType utility
 * @domain kody
 * @pattern audit-record
 * @ai-summary `recordAudit(req, spec)` — the one call sites use to log a
 *   dashboard action. It (1) resolves the VERIFIED actor from the request's
 *   PAT (not the client-claimed login), (2) writes to the in-memory hot ring
 *   for instant reads, and (3) durably persists to the audit manifest issue.
 *
 *   All of (1)-(3) run inside Next's `after()` so the user's action returns
 *   immediately and is never blocked or failed by audit logging. The durable
 *   write sets the GitHub context explicitly (the context module is a
 *   per-instance global that is torn down once the response is sent), and is
 *   attributed to the acting user's own PAT so it spends that user's rate
 *   budget, not the shared polling token.
 */
import { after, type NextRequest } from "next/server";
import { getRequestAuth, resolveActorFromToken } from "@dashboard/lib/auth";
import {
  createUserOctokit,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import {
  pushAuditEntry,
  newAuditId,
  type AuditEvent,
  type AuditOutcome,
} from "./action-log";
import { appendAuditDurable } from "./audit-store";

export interface AuditSpec {
  /** Coarse verb, e.g. "duty.run", "task.action". Becomes `AuditEvent.type`. */
  action: string;
  /** What was acted on, e.g. "changelog-verify", "#1587". Becomes `target`. */
  resource: string;
  /** Deep link to the resource (issue/PR/run), when known. */
  resourceUrl?: string | null;
  /** Duty slug, when relevant. */
  duty?: string | null;
  /** Agent (agentIdentity) slug that executed, when relevant. */
  agent?: string | null;
  /** Coarse result. Defaults to "ok". */
  outcome?: AuditOutcome;
  /** One-line human context (the sub-action, target name, etc.). */
  detail?: string | null;
}

/**
 * Record a dashboard action to the audit trail. Fire-and-forget: returns
 * immediately, never throws, never blocks or fails the observed action.
 */
export function recordAudit(req: NextRequest, spec: AuditSpec): void {
  const auth = getRequestAuth(req);
  const repo = auth ? `${auth.owner}/${auth.repo}` : null;

  const work = async () => {
    const actor = auth ? await resolveActorFromToken(auth.token) : null;
    const event: AuditEvent = {
      id: newAuditId(),
      at: new Date().toISOString(),
      type: spec.action,
      target: spec.resource,
      actor: actor?.login ?? "unknown",
      repo,
      detail: spec.detail?.trim() || null,
      actorType: "user",
      duty: spec.duty ?? null,
      agent: spec.agent ?? null,
      outcome: spec.outcome ?? "ok",
      resourceUrl: spec.resourceUrl ?? null,
      source: "dashboard",
    };

    // Hot tier: instant reads on this instance.
    pushAuditEntry(event);

    // Durable tier: only when we have the user's PAT + repo context.
    if (!auth) return;
    try {
      setGitHubContext(auth.owner, auth.repo, auth.token);
      await appendAuditDurable([event], createUserOctokit(auth.token));
    } catch (err) {
      logger.warn({ err }, "recordAudit: durable persist failed");
    }
  };

  try {
    after(work);
  } catch {
    // `after()` unavailable (called outside a request scope) — at least keep
    // the in-memory entry so nothing is silently dropped.
    void work().catch(() => {});
  }
}
