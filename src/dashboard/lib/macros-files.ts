/**
 * @fileType util
 * @domain preview
 * @pattern state-repo-file-store
 * @ai-summary Server-side store for saved preview macros, moved off
 *   per-browser localStorage into a single state-repo file `macros.json` so
 *   chat (server-side) and every device can read, rename, and delete them.
 *   Shape: `{ version: 1, macros: Macro[] }`. Reads use the module-level
 *   GitHub context (getOctokit/getOwner/getRepo, set by the chat route + API
 *   handlers) unless an octokit is passed; writes pass an explicit octokit,
 *   mirroring context-files.ts / reports-files.ts.
 *
 *   The recorder (browser extension) still captures the steps and the
 *   dashboard form still names them — only the persistence target changed.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "./github-client";
import { readStateText, writeStateText } from "./state-repo";
import type { Macro } from "./macros";

export const MACROS_PATH = "macros.json";

interface MacrosDocument {
  version: 1;
  macros: Macro[];
}

const EMPTY_DOC: MacrosDocument = { version: 1, macros: [] };

function isMacro(m: unknown): m is Macro {
  return (
    !!m &&
    typeof m === "object" &&
    typeof (m as Macro).id === "string" &&
    typeof (m as Macro).name === "string" &&
    typeof (m as Macro).createdAt === "number" &&
    Array.isArray((m as Macro).steps)
  );
}

function parseDoc(raw: string): MacrosDocument {
  try {
    const parsed = JSON.parse(raw);
    const macros = Array.isArray(parsed?.macros)
      ? parsed.macros.filter(isMacro)
      : [];
    return { version: 1, macros };
  } catch {
    return { ...EMPTY_DOC };
  }
}

/**
 * Read the macros file. Returns the parsed list (newest-first, matching the
 * old localStorage behavior) plus the blob sha (null when the file does not
 * exist yet — first save).
 */
export async function readMacrosFile(
  octokitOverride?: Octokit,
): Promise<{ macros: Macro[]; sha: string | null }> {
  const octokit = octokitOverride ?? getOctokit();
  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), MACROS_PATH);
    if (!file) {
      return { macros: [], sha: null };
    }
    const doc = parseDoc(file.content);
    const macros = doc.macros.slice().sort((a, b) => b.createdAt - a.createdAt);
    return { macros, sha: file.sha };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      return { macros: [], sha: null };
    }
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  macros: Macro[];
  sha?: string | null;
  message?: string;
}

/** Overwrite the whole macros file. Callers build the next list. */
export async function writeMacrosFile(
  opts: WriteOptions,
): Promise<{ macros: Macro[] }> {
  const doc: MacrosDocument = { version: 1, macros: opts.macros };
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: MACROS_PATH,
    message: opts.message ?? "chore(macros): update saved preview macros",
    content,
    sha: opts.sha ?? undefined,
  });
  return { macros: opts.macros };
}

function newId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `${base || "macro"}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Append a new macro (name + steps). Server stamps id + createdAt. Empty
 * names or zero-step recordings are rejected.
 */
export async function addMacroToFile(opts: {
  octokit: Octokit;
  name: string;
  steps: Macro["steps"];
  message?: string;
}): Promise<Macro> {
  const name = opts.name.trim().slice(0, 64);
  if (!name) throw new Error("Macro name is required");
  if (!opts.steps || opts.steps.length === 0) {
    throw new Error("A macro needs at least one step");
  }
  const { macros, sha } = await readMacrosFile(opts.octokit);
  const macro: Macro = {
    id: newId(name),
    name,
    createdAt: Date.now(),
    steps: opts.steps,
  };
  await writeMacrosFile({
    octokit: opts.octokit,
    macros: [macro, ...macros],
    sha,
    message: opts.message ?? `chore(macros): add ${name}`,
  });
  return macro;
}

/** Delete a macro by id. Returns true if one was removed. */
export async function deleteMacroFromFile(opts: {
  octokit: Octokit;
  id: string;
  message?: string;
}): Promise<boolean> {
  const { macros, sha } = await readMacrosFile(opts.octokit);
  const next = macros.filter((m) => m.id !== opts.id);
  if (next.length === macros.length) return false;
  await writeMacrosFile({
    octokit: opts.octokit,
    macros: next,
    sha,
    message: opts.message ?? `chore(macros): delete ${opts.id}`,
  });
  return true;
}

/** Rename a macro by id. Returns the updated macro, or null if not found. */
export async function renameMacroInFile(opts: {
  octokit: Octokit;
  id: string;
  name: string;
  message?: string;
}): Promise<Macro | null> {
  const name = opts.name.trim().slice(0, 64);
  if (!name) throw new Error("New name is required");
  const { macros, sha } = await readMacrosFile(opts.octokit);
  let updated: Macro | null = null;
  const next = macros.map((m) => {
    if (m.id !== opts.id) return m;
    updated = { ...m, name };
    return updated;
  });
  if (!updated) return null;
  await writeMacrosFile({
    octokit: opts.octokit,
    macros: next,
    sha,
    message: opts.message ?? `chore(macros): rename ${opts.id} to ${name}`,
  });
  return updated;
}
