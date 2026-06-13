/**
 * @fileType utility
 * @domain kody
 * @pattern audit-log-manifest-cas
 * @ai-summary Durable, cross-instance store for the dashboard audit trail.
 *   A bounded ring of the most-recent audit events lives in the body of a
 *   single `kody:audit-log` manifest issue, mutated through the shared
 *   manifest-store CAS (read → mutate → write → verify, per-repo mutex).
 *
 *   Why a body ring (not issue comments / a DB): reuses the battle-tested
 *   CAS path, needs no new pagination or storage, and the cached/ETag read
 *   keeps polling cheap (rate-limit rule #2/#3). Trade-off: history is capped
 *   at MAX_DURABLE recent events — long-term retention is a deliberate
 *   follow-up, not part of this first cut. Writes are attributed to the
 *   acting user's PAT (passed as `userOctokit`) so they draw on that user's
 *   personal rate budget, never the shared polling token.
 */
import type { Octokit } from "@octokit/rest";
import { createManifestStore } from "../manifest-store";
import { AUDIT_LOG_LABEL, AUDIT_LOG_ISSUE_TITLE } from "../constants";
import type { AuditEvent } from "./action-log";

/** Keep the manifest body well under GitHub's 65,536-char issue-body limit. */
const MAX_DURABLE = 150;
/** Clamp free-form detail so one fat entry can't blow the body budget. */
const MAX_DETAIL = 160;

interface AuditManifest {
  version: 1;
  events: AuditEvent[];
}

const BEGIN = "<!--KODY_AUDIT_JSON";
const END = "KODY_AUDIT_JSON-->";

function emptyManifest(): AuditManifest {
  return { version: 1, events: [] };
}

function parseBody(body: string | null | undefined): AuditManifest {
  if (!body) return emptyManifest();
  const start = body.indexOf(BEGIN);
  const end = body.indexOf(END);
  if (start === -1 || end === -1 || end <= start) return emptyManifest();
  const json = body.slice(start + BEGIN.length, end).trim();
  try {
    const parsed = JSON.parse(json) as Partial<AuditManifest>;
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    return { version: 1, events };
  } catch {
    return emptyManifest();
  }
}

function serializeBody(manifest: AuditManifest): string {
  const json = JSON.stringify({ version: 1, events: manifest.events });
  return [
    "# Kody Audit Log",
    "",
    "Durable, append-only trail of dashboard actions (newest first). Managed",
    "by the dashboard — **do not edit by hand**. Surfaced on Activity → Log.",
    "",
    `Showing the most recent ${manifest.events.length} of up to ${MAX_DURABLE} events.`,
    "",
    BEGIN,
    json,
    END,
  ].join("\n");
}

/** Events are equal when their ids line up in order — enough for CAS verify. */
function manifestsEqual(a: AuditManifest, b: AuditManifest): boolean {
  if (a.events.length !== b.events.length) return false;
  for (let i = 0; i < a.events.length; i++) {
    if (a.events[i].id !== b.events[i].id) return false;
  }
  return true;
}

const store = createManifestStore<AuditManifest>({
  label: AUDIT_LOG_LABEL,
  title: AUDIT_LOG_ISSUE_TITLE,
  name: "audit log",
  lockPrefix: "audit:",
  parse: parseBody,
  serialize: serializeBody,
  empty: emptyManifest,
  equals: manifestsEqual,
});

function clampDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return detail.length > MAX_DETAIL
    ? `${detail.slice(0, MAX_DETAIL - 1)}…`
    : detail;
}

/**
 * Prepend new events to the durable ring (newest first), capped at
 * MAX_DURABLE. Best-effort: resolves to false on failure so the caller (an
 * after-response hook) never surfaces an error to the user.
 */
export async function appendAuditDurable(
  events: AuditEvent[],
  userOctokit?: Octokit,
): Promise<boolean> {
  if (events.length === 0) return true;
  const trimmed = events.map((e) => ({ ...e, detail: clampDetail(e.detail) }));
  try {
    await store.mutate(
      (current) => {
        const next: AuditManifest = {
          version: 1,
          events: [...trimmed, ...current.events].slice(0, MAX_DURABLE),
        };
        return { next, result: true };
      },
      userOctokit ? { userOctokit } : {},
    );
    return true;
  } catch {
    return false;
  }
}

/** Cached (ETag/304) read of the durable ring, newest-first. */
export async function readAuditDurable(): Promise<AuditEvent[]> {
  try {
    const manifest = await store.readCached();
    return manifest.events;
  } catch {
    return [];
  }
}
