/**
 * @fileType util
 * @domain kody
 * @pattern agent-mentions
 * @ai-summary Resolve `@slug` tokens in composed chat text. A direct
 * staff mention swaps the reply identity for the current turn; it does
 * not dispatch a runner task or create a control issue.
 */

// Same shape as the push mention matcher: `@` not preceded by an
// identifier/path char, then a GitHub-style slug. Kept independent so the
// two matchers can diverge without coupling.
const MENTION_RE = /(^|[^A-Za-z0-9_/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g;
const ACTIVE_MENTION_RE = /(^|[\s([{])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)?$/;

export interface StaffMentionTrigger {
  start: number;
  end: number;
  query: string;
}

export function parseStaffMentionTrigger(
  body: string,
  caretIndex: number,
): StaffMentionTrigger | null {
  const caret = Math.max(0, Math.min(caretIndex, body.length));
  const beforeCaret = body.slice(0, caret);
  const match = beforeCaret.match(ACTIVE_MENTION_RE);
  if (!match) return null;

  const query = match[2] ?? "";
  return {
    start: caret - query.length - 1,
    end: caret,
    query: query.toLowerCase(),
  };
}

export function replaceStaffMentionTrigger(
  body: string,
  trigger: StaffMentionTrigger,
  slug: string,
): string {
  const after = body.slice(trigger.end);
  const spacer = after.length === 0 || !/^\s/.test(after) ? " " : "";
  return `${body.slice(0, trigger.start)}@${slug}${spacer}${after}`;
}

/**
 * Extract agent slugs @mentioned in `body`, preserving first appearance order
 * and de-duplicating. Only slugs present in `knownSlugs` are returned.
 */
export function extractStaffMentions(
  body: string,
  knownSlugs: Iterable<string>,
): string[] {
  const known = new Set(Array.from(knownSlugs, (s) => s.toLowerCase()));
  if (known.size === 0 || !body) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const raw = m[2];
    if (!raw) continue;
    const slug = raw.toLowerCase();
    if (known.has(slug) && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/**
 * Direct chat routing needs a best-effort slug even before the async roster
 * finishes loading. If the roster is present, only known agents match. If the
 * roster is empty, return the first syntactically valid @slug and let the
 * server validate that the agent exists.
 */
export function extractFirstStaffMentionCandidate(
  body: string,
  knownSlugs: Iterable<string>,
): string | null {
  const knownMentions = extractStaffMentions(body, knownSlugs);
  if (knownMentions.length > 0) return knownMentions[0] ?? null;

  const known = Array.from(knownSlugs);
  if (known.length > 0 || !body) return null;

  const first = body.matchAll(MENTION_RE).next().value;
  const raw = first?.[2];
  return raw ? raw.toLowerCase() : null;
}

/** True when `body` mentions at least one known agent. */
export function hasStaffMention(
  body: string,
  knownSlugs: Iterable<string>,
): boolean {
  return extractStaffMentions(body, knownSlugs).length > 0;
}
