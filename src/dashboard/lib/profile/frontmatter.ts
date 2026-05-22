/**
 * @fileType util
 * @domain kody
 * @pattern profile-frontmatter
 * @ai-summary YAML frontmatter parser/serializer for company-profile
 *   files (`.kody/profile/<slug>.md`). The single recognized field is
 *   `for:` — the consumer scope that decides who loads the section:
 *   `chat` (the in-process kody chat system prompt), `qa` (the QA
 *   consumer), or `all` (every consumer). Flat scalar keys only — same
 *   30-line parser shape as `prompts/frontmatter.ts` and
 *   `ticked/frontmatter.ts`; no `gray-matter` dep on purpose.
 *
 *   Profile files historically had NO frontmatter (the whole file was
 *   the section). A frontmatter-less file therefore defaults to `chat`
 *   so existing data keeps flowing to the chat prompt unchanged.
 */

/** Consumer scope for a profile section. */
export type ProfileScope = "chat" | "qa" | "all";

/** Default when a profile file carries no `for:` — preserves legacy behavior. */
export const DEFAULT_PROFILE_SCOPE: ProfileScope = "chat";

const PROFILE_SCOPE_VALUES: readonly ProfileScope[] = [
  "chat",
  "qa",
  "all",
] as const;

export const ALL_PROFILE_SCOPES = PROFILE_SCOPE_VALUES;

export interface ProfileFrontmatter {
  /**
   * Consumer that loads this section. Absent on disk = `chat` (the legacy
   * default), applied by `splitProfileFrontmatter`.
   */
  for: ProfileScope;
}

/** True if the value is a recognized profile scope token. */
export function isProfileScope(value: unknown): value is ProfileScope {
  return (
    typeof value === "string" &&
    (PROFILE_SCOPE_VALUES as readonly string[]).includes(value)
  );
}

/** Human-readable label for a scope token. */
export function profileScopeLabel(scope: ProfileScope): string {
  switch (scope) {
    case "chat":
      return "Chat";
    case "qa":
      return "QA";
    case "all":
      return "All";
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse the leading frontmatter block (if any) from a raw profile file.
 * `for` defaults to `chat` when the block is missing or omits the key, so
 * existing frontmatter-less files keep going to the chat prompt.
 */
export function splitProfileFrontmatter(raw: string): {
  frontmatter: ProfileFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { frontmatter: { for: DEFAULT_PROFILE_SCOPE }, body: raw };
  }
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

/**
 * Re-attach a frontmatter block to a body. The `for:` line is always
 * emitted (even for the `chat` default) so the section's scope is explicit
 * on disk once it has been written through the dashboard.
 */
export function joinProfileFrontmatter(
  frontmatter: ProfileFrontmatter,
  body: string,
): string {
  const lines = [`for: ${frontmatter.for}`];
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ────────────────────────────────────────────────────────────────────
// Internals — flat YAML only (key: scalar). No nesting, no flow style.
// ────────────────────────────────────────────────────────────────────

function parseFlatYaml(text: string): ProfileFrontmatter {
  let scope: ProfileScope = DEFAULT_PROFILE_SCOPE;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (key === "for" && isProfileScope(value)) {
      scope = value;
    }
    // Unknown keys silently dropped on read.
  }
  return { for: scope };
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
