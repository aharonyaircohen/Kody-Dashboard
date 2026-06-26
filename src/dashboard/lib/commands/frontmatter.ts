/**
 * @fileType util
 * @domain kody
 * @pattern commands-frontmatter
 * @ai-summary YAML frontmatter parser/serializer for command files. The
 *   format mirrors Claude Code skills: `description` (one-line summary
 *   shown in the slash menu) and `argument-hint` (placeholder rendered
 *   next to the slug in autocomplete). Flat scalar keys only — same
 *   30-line parser shape as `capabilities-frontmatter.ts`.
 */

export interface CommandFrontmatter {
  /** Short one-line summary shown in the slash menu. */
  description?: string;
  /** Argument placeholder hint, e.g. `<pr-number>` or `[topic]`. */
  argumentHint?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(raw: string): {
  frontmatter: CommandFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

export function joinFrontmatter(
  frontmatter: CommandFrontmatter,
  body: string,
): string {
  const lines = serializeFlatYaml(frontmatter);
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

function parseFlatYaml(text: string): CommandFrontmatter {
  const out: CommandFrontmatter = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (!value) continue;
    if (key === "description") out.description = value;
    else if (key === "argument-hint" || key === "argumentHint")
      out.argumentHint = value;
  }
  return out;
}

function serializeFlatYaml(frontmatter: CommandFrontmatter): string[] {
  const lines: string[] = [];
  if (frontmatter.description)
    lines.push(`description: ${quoteIfNeeded(frontmatter.description)}`);
  if (frontmatter.argumentHint)
    lines.push(`argument-hint: ${quoteIfNeeded(frontmatter.argumentHint)}`);
  return lines;
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

function quoteIfNeeded(value: string): string {
  if (/[:#"'\n]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
