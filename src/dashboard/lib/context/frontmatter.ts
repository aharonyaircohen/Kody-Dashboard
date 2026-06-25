/**
 * @fileType util
 * @domain kody
 * @pattern context-frontmatter
 * @ai-summary YAML frontmatter parser/serializer for context-entry files
 *   (`context/<slug>.md` in the state repo). The single recognized field is `agent:` —
 *   the list of agent-member slugs that own the entry. Each consumer loads
 *   the context attached to *its* agent:
 *     - the in-process kody chat loads context attached to the built-in chat
 *       agent (`kody`), and
 *     - the engine's QA preflight loads context attached to `qa-engineer`.
 *   Written as an inline YAML list on one line (`agent: [kody, qa-engineer]`)
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

/** Slug of the built-in chat agent — the agentIdentity the in-process kody chat runs as. Constant, not a persisted `agents/*.md` file. */
export const KODY_CHAT_AGENT = "kody";

/** Slug of the QAn agent the engine's QA/ui-review preflight runs as. */
export const QA_AGENT = "qa-engineer";

/**
 * Wildcard token: an entry owned by `*` is loaded by *every* consumer (chat,
 * QA, and any future agent). Canonicalized to a lone `["*"]` — it never
 * coexists with specific slugs.
 */
export const ALL_AGENT = "*";

/**
 * Default `agent:` for a context file with no frontmatter — preserves the
 * legacy "frontmatter-less file feeds the chat prompt" behavior.
 */
export const DEFAULT_CONTEXT_AGENT: readonly string[] = [KODY_CHAT_AGENT];

/** Map a legacy `audience:` token to its agent-member slug equivalent. */
const LEGACY_AUDIENCE_TO_AGENT: Record<string, string> = {
  chat: KODY_CHAT_AGENT,
  qa: QA_AGENT,
};

/** Same slug shape as context/agents/agentResponsibility slugs. */
const AGENT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ContextFrontmatter {
  /**
   * Agent-member slugs that own this entry. Absent on disk = `["kody"]`
   * (the legacy chat default), applied by `splitContextFrontmatter`. An
   * explicit empty list (`agent: []`) is a valid "unassigned" entry — owned
   * by nobody, loaded by no consumer. Deduped, order-preserving.
   */
  agent: string[];
}

/** True if the value is a syntactically valid agent slug. */
export function isAgentSlug(value: unknown): value is string {
  return typeof value === "string" && AGENT_SLUG_RE.test(value);
}

/** True if the value is a real agent slug OR the `*` all-agent wildcard. */
function isStaffToken(value: string): boolean {
  return value === ALL_AGENT || AGENT_SLUG_RE.test(value);
}

/** Dedupe; collapse to a lone `["*"]` when the all-agent wildcard is present. */
function canonicalizeStaff(values: readonly string[]): string[] {
  const out = dedupe(values);
  return out.includes(ALL_AGENT) ? [ALL_AGENT] : out;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse the leading frontmatter block (if any) from a raw context file.
 * `agent` defaults to `["kody"]` when the block is missing or names no
 * recognizable agent, so frontmatter-less files keep going to the chat
 * prompt. A legacy `audience:` list is mapped onto agent slugs.
 */
export function splitContextFrontmatter(raw: string): {
  frontmatter: ContextFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      frontmatter: { agent: [...DEFAULT_CONTEXT_AGENT] },
      body: raw,
    };
  }
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

/**
 * Re-attach a frontmatter block to a body. The `agent:` line is always
 * emitted (even for the `["kody"]` default) as an inline YAML list —
 * `agent: [kody, qa-engineer]` — which the kody engine's inline-list parser
 * understands. Keep this format inline, comma-separated, square brackets.
 */
export function joinContextFrontmatter(
  frontmatter: ContextFrontmatter,
  body: string,
): string {
  const agent = normalizeStaff(frontmatter.agent);
  const lines = [`agent: [${agent.join(", ")}]`];
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ────────────────────────────────────────────────────────────────────
// Internals — flat YAML only (key: scalar | inline list). No nesting.
// ────────────────────────────────────────────────────────────────────

function parseFlatYaml(text: string): ContextFrontmatter {
  // An explicit `agent:` line wins — even when empty (`agent: []` is a valid
  // "unassigned" entry, owned by nobody and loaded by no consumer). The legacy
  // `audience:` mapping is only consulted when no `agent:` line is present.
  let agent: string[] | null = null;
  let legacyStaff: string[] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "agent") {
      agent = canonicalizeStaff(parseSlugList(value)); // may be [] → unassigned
    } else if (key === "audience" || key === "for") {
      const mapped = parseSlugList(value)
        .map((t) => LEGACY_AUDIENCE_TO_AGENT[t])
        .filter((s): s is string => Boolean(s));
      if (mapped.length > 0) legacyStaff = dedupe(mapped);
    }
    // Unknown keys silently dropped on read.
  }
  return { agent: agent ?? legacyStaff ?? [...DEFAULT_CONTEXT_AGENT] };
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
function normalizeStaff(agent: readonly string[]): string[] {
  return canonicalizeStaff(agent.filter(isStaffToken));
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
