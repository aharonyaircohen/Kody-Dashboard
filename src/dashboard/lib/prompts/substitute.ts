/**
 * @fileType util
 * @domain kody
 * @pattern prompts-substitute
 * @ai-summary Substitute slash-command arguments into a prompt body.
 *   Mirrors Claude Code semantics so muscle memory transfers:
 *     - `$ARGUMENTS`  → full argument string (everything after `/slug `)
 *     - `$0`, `$1`, … → positional args, shell-style quoted
 *     - `$ARGUMENTS[N]` → same as `$N`, longer form
 *   If the body contains no `$ARGUMENTS` placeholder and arguments were
 *   passed, we append `ARGUMENTS: <value>` so the model still sees them
 *   (matches the CLI's fallback behavior).
 */

export interface SubstituteResult {
  text: string;
  /** Whether any placeholder was matched. */
  hadPlaceholder: boolean;
}

const FULL_PLACEHOLDER = /\$ARGUMENTS\b(?!\[)/g;
const INDEXED_PLACEHOLDER = /\$ARGUMENTS\[(\d+)\]/g;
const SHORT_PLACEHOLDER = /\$(\d+)\b/g;

/**
 * Split a raw argument string into shell-style positional tokens.
 * Supports double- and single-quoted strings (no escapes — matches the
 * minimal CLI behavior). Multi-word quoted segments become a single
 * token.
 */
export function tokenizeArguments(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

export function substitute(
  body: string,
  rawArguments: string,
): SubstituteResult {
  const args = rawArguments ?? "";
  const tokens = tokenizeArguments(args);
  let hadPlaceholder = false;
  let text = body;

  if (FULL_PLACEHOLDER.test(text)) {
    hadPlaceholder = true;
    text = text.replace(FULL_PLACEHOLDER, args);
  }
  text = text.replace(INDEXED_PLACEHOLDER, (_, n: string) => {
    hadPlaceholder = true;
    return tokens[Number(n)] ?? "";
  });
  text = text.replace(SHORT_PLACEHOLDER, (match, n: string) => {
    hadPlaceholder = true;
    return tokens[Number(n)] ?? "";
  });

  if (!hadPlaceholder && args.trim().length > 0) {
    text = `${text.trimEnd()}\n\nARGUMENTS: ${args}`;
  }

  return { text, hadPlaceholder };
}
