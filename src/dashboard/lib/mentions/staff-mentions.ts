/**
 * @fileType util
 * @domain kody
 * @pattern worker-mentions
 * @ai-summary Resolve `@slug` tokens in a composed message against the
 *   known worker roster. A worker mention is distinct from a GitHub
 *   @login: when a token matches a worker slug it dispatches an ad-hoc
 *   `worker-ask` tick instead of (only) notifying a person. Worker wins
 *   on collision with a GitHub login — the same precedence rule repo
 *   prompts use over built-ins (the more specific, repo-owned thing wins).
 */

// Same shape as the push mention matcher: `@` not preceded by an
// identifier/path char, then a GitHub-style slug. Kept independent so the
// two matchers can diverge without coupling.
const MENTION_RE = /(^|[^A-Za-z0-9_/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g;

/**
 * Extract the set of worker slugs @mentioned in `body`, preserving the
 * order of first appearance and de-duplicating. Only slugs present in
 * `knownSlugs` are returned — an unknown `@x` is left to the normal
 * GitHub-mention path.
 */
export function extractWorkerMentions(
  body: string,
  knownSlugs: Iterable<string>,
): string[] {
  const known = new Set(
    Array.from(knownSlugs, (s) => s.toLowerCase()),
  );
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

/** True when `body` mentions at least one known worker. */
export function hasWorkerMention(
  body: string,
  knownSlugs: Iterable<string>,
): boolean {
  return extractWorkerMentions(body, knownSlugs).length > 0;
}
