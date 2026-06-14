/**
 * @fileType util
 * @domain kody
 * @pattern context-frontmatter
 * @ai-summary YAML frontmatter parser/serializer for context-entry files
 *   (`.kody/context/<slug>.md`). The single recognized field is `staff:` —
 *   the list of staff-member slugs that own the entry. Each consumer loads
 *   the context attached to *its* staff member:
 *     - the in-process kody chat loads context attached to the built-in chat
 *       staff (`kody`), and
 *     - the engine's QA preflight loads context attached to `qa-engineer`.
 *   Written as an inline YAML list on one line (`staff: [kody, qa-engineer]`)
 *   because the kody engine parses it with a simple inline-list reader —
 *   keep it inline, comma-separated, square brackets. Flat keys only — same
 *   ~30-line parser shape as `prompts/frontmatter.ts` and
 *   `ticked/frontmatter.ts`; no `gray-matter` dep on purpose.
 *
 *   Legacy files used an `audience:` list of consumers (`chat` / `qa`) or
 *   had NO frontmatter at all. Both are mapped on read so existing data
 *   keeps flowing: `chat` → `kody`, `qa` → `qa-engineer`, and a
 *   frontmatter-less file defaults to `[kody]` (legacy = chat-only).
 */

/** Slug of the built-in chat staff member — the persona the in-process kody chat runs as. Constant, not a `.kody/staff/*.md` file. */
export const KODY_CHAT_STAFF = "kody";

/** Slug of the QA staff member the engine's QA/ui-review preflight runs as. */
export const QA_STAFF = "qa-engineer";

/**
 * Wildcard token: an entry owned by `*` is loaded by *every* consumer (chat,
 * QA, and any future staff). Canonicalized to a lone `["*"]` — it never
 * coexists with specific slugs.
 */
export const ALL_STAFF = "*";

/**
 * Default `staff:` for a context file with no frontmatter — preserves the
 * legacy "frontmatter-less file feeds the chat prompt" behavior.
 */
export const DEFAULT_CONTEXT_STAFF: readonly string[] = [KODY_CHAT_STAFF];

/** Map a legacy `audience:` token to its staff-member slug equivalent. */
const LEGACY_AUDIENCE_TO_STAFF: Record<string, string> = {
  chat: KODY_CHAT_STAFF,
  qa: QA_STAFF,
};

/** Same slug shape as context/staff/duty slugs. */
const STAFF_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ContextFrontmatter {
  /**
   * Staff-member slugs that own this entry. Absent on disk = `["kody"]`
   * (the legacy chat default), applied by `splitContextFrontmatter`. An
   * explicit empty list (`staff: []`) is a valid "unassigned" entry — owned
   * by nobody, loaded by no consumer. Deduped, order-preserving.
   */
  staff: string[];
}

/** True if the value is a syntactically valid staff slug. */
export function isStaffSlug(value: unknown): value is string {
  return typeof value === "string" && STAFF_SLUG_RE.test(value);
}

/** True if the value is a real staff slug OR the `*` all-staff wildcard. */
function isStaffToken(value: string): boolean {
  return value === ALL_STAFF || STAFF_SLUG_RE.test(value);
}

/** Dedupe; collapse to a lone `["*"]` when the all-staff wildcard is present. */
function canonicalizeStaff(values: readonly string[]): string[] {
  const out = dedupe(values);
  return out.includes(ALL_STAFF) ? [ALL_STAFF] : out;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse the leading frontmatter block (if any) from a raw context file.
 * `staff` defaults to `["kody"]` when the block is missing or names no
 * recognizable staff, so frontmatter-less files keep going to the chat
 * prompt. A legacy `audience:` list is mapped onto staff slugs.
 */
export function splitContextFrontmatter(raw: string): {
  frontmatter: ContextFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      frontmatter: { staff: [...DEFAULT_CONTEXT_STAFF] },
      body: raw,
    };
  }
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

/**
 * Re-attach a frontmatter block to a body. The `staff:` line is always
 * emitted (even for the `["kody"]` default) as an inline YAML list —
 * `staff: [kody, qa-engineer]` — which the kody engine's inline-list parser
 * understands. Keep this format inline, comma-separated, square brackets.
 */
export function joinContextFrontmatter(
  frontmatter: ContextFrontmatter,
  body: string,
): string {
  const staff = normalizeStaff(frontmatter.staff);
  const lines = [`staff: [${staff.join(", ")}]`];
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ────────────────────────────────────────────────────────────────────
// Internals — flat YAML only (key: scalar | inline list). No nesting.
// ────────────────────────────────────────────────────────────────────

function parseFlatYaml(text: string): ContextFrontmatter {
  // An explicit `staff:` line wins — even when empty (`staff: []` is a valid
  // "unassigned" entry, owned by nobody and loaded by no consumer). The legacy
  // `audience:` mapping is only consulted when no `staff:` line is present.
  let staff: string[] | null = null;
  let legacyStaff: string[] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "staff") {
      staff = canonicalizeStaff(parseSlugList(value)); // may be [] → unassigned
    } else if (key === "audience" || key === "for") {
      const mapped = parseSlugList(value)
        .map((t) => LEGACY_AUDIENCE_TO_STAFF[t])
        .filter((s): s is string => Boolean(s));
      if (mapped.length > 0) legacyStaff = dedupe(mapped);
    }
    // Unknown keys silently dropped on read.
  }
  return { staff: staff ?? legacyStaff ?? [...DEFAULT_CONTEXT_STAFF] };
}

/**
 * Parse a slug list — either an inline list (`[a, b]`) or a bare scalar
 * (`a`). Tokens are lowercased; invalid slugs are dropped. Result is
 * deduped, order-preserving.
 */
function parseSlugList(value: string): string[] {
  const inner =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const tokens = inner
    .split(",")
    .map((t) => stripQuotes(t.trim()).toLowerCase())
    .filter((t) => t.length > 0);
  const out: string[] = [];
  for (const token of tokens) {
    if (isStaffToken(token) && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Drop invalid tokens, dedupe, and collapse the `*` wildcard to `["*"]`.
 * May return `[]` — an explicit empty list is a valid "unassigned" entry, so
 * we do NOT fall back to the default here (the frontmatter-less default
 * lives in `splitContextFrontmatter`).
 */
function normalizeStaff(staff: readonly string[]): string[] {
  return canonicalizeStaff(staff.filter(isStaffToken));
}

function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (!out.includes(v)) out.push(v);
  return out;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
