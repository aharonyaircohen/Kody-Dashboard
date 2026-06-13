/**
 * @fileType utility
 * @domain changelog
 * @pattern keep-a-changelog
 * @ai-summary Pure transforms over a Keep-a-Changelog markdown document.
 *   `appendUnreleasedEntry` inserts a bullet under `## [Unreleased]` (idempotent
 *   by PR number). `promoteUnreleased` renames the Unreleased heading to a
 *   versioned section and inserts a fresh empty Unreleased above it.
 *   No I/O — callers handle the GitHub read/write.
 */

export const UNRELEASED_HEADER = "## [Unreleased]";

const INITIAL_TEMPLATE =
  "# Changelog\n\n" +
  "All notable changes to this project will be documented in this file.\n\n" +
  "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n" +
  "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n" +
  `${UNRELEASED_HEADER}\n\n`;

export interface ChangelogEntry {
  prNumber: number;
  prUrl: string;
  title: string;
  author: string;
}

/** Format a single bullet line for a merged PR. */
export function formatEntry(entry: ChangelogEntry): string {
  return `- ${entry.title} ([#${entry.prNumber}](${entry.prUrl})) — @${entry.author}`;
}

function hasEntryForPR(md: string, prNumber: number): boolean {
  return md.includes(`[#${prNumber}]`);
}

function ensureUnreleasedSection(md: string): string {
  if (!md.trim()) return INITIAL_TEMPLATE;
  if (md.includes(UNRELEASED_HEADER)) return md;

  const lines = md.split("\n");
  const h1Index = lines.findIndex((l) => l.startsWith("# "));
  if (h1Index >= 0) {
    const insertAt = h1Index + 1;
    lines.splice(insertAt, 0, "", UNRELEASED_HEADER, "");
    return lines.join("\n");
  }
  return `# Changelog\n\n${UNRELEASED_HEADER}\n\n${md}`;
}

/**
 * Insert `entry` as the first bullet under `## [Unreleased]`. Idempotent on
 * `prNumber` — a second call with the same PR is a no-op (returns input).
 */
export function appendUnreleasedEntry(
  currentMd: string,
  entry: ChangelogEntry,
): string {
  if (hasEntryForPR(currentMd, entry.prNumber)) return currentMd;

  const md = ensureUnreleasedSection(currentMd);
  const lines = md.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim() === UNRELEASED_HEADER);
  if (headerIdx === -1) return md;

  let insertAt = headerIdx + 1;
  // Skip one immediately-following blank line so the bullet sits with a
  // separator from the heading.
  if (lines[insertAt]?.trim() === "") insertAt++;

  lines.splice(insertAt, 0, formatEntry(entry));
  return lines.join("\n");
}

/**
 * Returns true if the Unreleased section contains at least one bullet line.
 * Used to skip promotion of empty sections (no merges since last release).
 */
export function hasUnreleasedEntries(md: string): boolean {
  const headerEsc = UNRELEASED_HEADER.replace(/[[\]]/g, "\\$&");
  const re = new RegExp(`${headerEsc}\\s*\\n([\\s\\S]*?)(?=\\n## \\[|$)`, "m");
  const match = md.match(re);
  if (!match) return false;
  return /^\s*-\s+/m.test(match[1] ?? "");
}

/**
 * Promote `## [Unreleased]` to `## [version] - YYYY-MM-DD`, inserting a fresh
 * empty Unreleased section above. No-op if the existing Unreleased section is
 * empty or absent. Idempotent on the (version, date) pair — a duplicate call
 * with the same version returns the document unchanged.
 */
export function promoteUnreleased(
  currentMd: string,
  version: string,
  dateISO: string,
): string {
  if (!currentMd.includes(UNRELEASED_HEADER)) return currentMd;
  if (!hasUnreleasedEntries(currentMd)) return currentMd;

  const date = (dateISO.split("T")[0] ?? dateISO).trim();
  const newVersionHeader = `## [${version}] - ${date}`;
  if (currentMd.includes(newVersionHeader)) return currentMd;

  return currentMd.replace(
    UNRELEASED_HEADER,
    `${UNRELEASED_HEADER}\n\n${newVersionHeader}`,
  );
}
