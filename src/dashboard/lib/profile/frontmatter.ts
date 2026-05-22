/**
 * @fileType util
 * @domain kody
 * @pattern profile-frontmatter
 * @ai-summary YAML frontmatter parser/serializer for company-profile
 *   files (`.kody/profile/<slug>.md`). The single recognized field is
 *   `audience:` — the list of consumers that load the section: `chat`
 *   (the in-process kody chat system prompt) and/or `qa` (the QA
 *   consumer). Written as an inline YAML list on one line
 *   (`audience: [chat, qa]`) because the kody engine parses it with a
 *   simple inline-list reader — keep it inline, comma-separated, square
 *   brackets. Flat keys only — same ~30-line parser shape as
 *   `prompts/frontmatter.ts` and `ticked/frontmatter.ts`; no
 *   `gray-matter` dep on purpose.
 *
 *   Profile files historically had NO frontmatter (the whole file was
 *   the section). A frontmatter-less file therefore defaults to
 *   `[chat]` so existing data keeps flowing to the chat prompt
 *   unchanged.
 */

/** A single consumer that may load a profile section. */
export type ProfileAudience = "chat" | "qa";

/** Default when a profile file carries no `audience:` — preserves legacy behavior. */
export const DEFAULT_PROFILE_AUDIENCE: readonly ProfileAudience[] = ["chat"];

const PROFILE_AUDIENCE_VALUES: readonly ProfileAudience[] = [
  "chat",
  "qa",
] as const;

export const ALL_PROFILE_AUDIENCES = PROFILE_AUDIENCE_VALUES;

export interface ProfileFrontmatter {
  /**
   * Consumers that load this section. Absent on disk = `["chat"]` (the
   * legacy default), applied by `splitProfileFrontmatter`. Always
   * non-empty and deduped.
   */
  audience: ProfileAudience[];
}

/** True if the value is a recognized profile audience token. */
export function isProfileAudience(value: unknown): value is ProfileAudience {
  return (
    typeof value === "string" &&
    (PROFILE_AUDIENCE_VALUES as readonly string[]).includes(value)
  );
}

/** Human-readable label for an audience token. */
export function profileAudienceLabel(audience: ProfileAudience): string {
  switch (audience) {
    case "chat":
      return "Chat";
    case "qa":
      return "QA";
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse the leading frontmatter block (if any) from a raw profile file.
 * `audience` defaults to `["chat"]` when the block is missing or omits
 * the key, so existing frontmatter-less files keep going to the chat
 * prompt.
 */
export function splitProfileFrontmatter(raw: string): {
  frontmatter: ProfileFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      frontmatter: { audience: [...DEFAULT_PROFILE_AUDIENCE] },
      body: raw,
    };
  }
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

/**
 * Re-attach a frontmatter block to a body. The `audience:` line is
 * always emitted (even for the `["chat"]` default) as an inline YAML
 * list — `audience: [chat, qa]` — which the kody engine's inline-list
 * parser understands. Keep this format inline, comma-separated, square
 * brackets.
 */
export function joinProfileFrontmatter(
  frontmatter: ProfileFrontmatter,
  body: string,
): string {
  const audience = normalizeAudience(frontmatter.audience);
  const lines = [`audience: [${audience.join(", ")}]`];
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ────────────────────────────────────────────────────────────────────
// Internals — flat YAML only (key: scalar | inline list). No nesting.
// ────────────────────────────────────────────────────────────────────

function parseFlatYaml(text: string): ProfileFrontmatter {
  let audience: ProfileAudience[] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    // Canonical key plus a trivial tolerance for the legacy `for:` scalar.
    if (key === "audience" || key === "for") {
      const parsed = parseAudienceValue(value);
      if (parsed.length > 0) audience = parsed;
    }
    // Unknown keys silently dropped on read.
  }
  return { audience: audience ?? [...DEFAULT_PROFILE_AUDIENCE] };
}

/**
 * Parse an audience value — either an inline list (`[chat, qa]`) or a
 * bare scalar (`qa`). Unknown tokens (including the dropped `all`) are
 * ignored. Result is deduped, order-preserving.
 */
function parseAudienceValue(value: string): ProfileAudience[] {
  const inner = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  const tokens = inner
    .split(",")
    .map((t) => stripQuotes(t.trim()))
    .filter((t) => t.length > 0);
  const out: ProfileAudience[] = [];
  for (const token of tokens) {
    if (isProfileAudience(token) && !out.includes(token)) out.push(token);
  }
  return out;
}

/** Dedupe and guarantee a non-empty audience, falling back to the default. */
function normalizeAudience(
  audience: readonly ProfileAudience[],
): ProfileAudience[] {
  const out: ProfileAudience[] = [];
  for (const a of audience) {
    if (isProfileAudience(a) && !out.includes(a)) out.push(a);
  }
  return out.length > 0 ? out : [...DEFAULT_PROFILE_AUDIENCE];
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
