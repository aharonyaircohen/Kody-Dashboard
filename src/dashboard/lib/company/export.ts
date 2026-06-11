/**
 * @fileType util
 * @domain kody
 * @pattern company-export
 * @ai-summary Build a portable Company bundle from the connected repo.
 *   Reads the company-level artifact types (staff, duties, commands,
 *   executables, instructions) via their existing file helpers and maps each to the
 *   repo-agnostic shape in `types.ts` — dropping sha/html_url/commit and
 *   tick timestamps, which are meaningless in another repo. Runs inside
 *   an established GitHub context (see the API route).
 */

import { getOctokit, getOwner, getRepo } from "../github-client";
import { listDutyFiles } from "../duties-files";
import { listStaffFiles } from "../staff-files";
import { listRepoCommandFiles } from "../commands/files";
import { listContextFiles } from "../context/files";
import { readInstructionsFile } from "../instructions/files";
import { listExecutableFiles, readExecutableFolderFiles } from "../executables";
import { getEngineConfig } from "../engine/config";
import {
  COMPANY_BUNDLE_VERSION,
  type CompanyBundle,
  type CompanyConfigBundle,
  type CompanyTickEntry,
  type CompanyCommandEntry,
  type CompanyExecutableEntry,
  type CompanyContextEntry,
} from "./types";
import type { TickFile } from "../ticked/files";
import type { CommandFile } from "../commands/files";
import type { ContextFile } from "../context/files";

function toTickEntry(file: TickFile): CompanyTickEntry {
  return {
    slug: file.slug,
    title: file.title,
    body: file.body,
    schedule: file.schedule,
    disabled: file.disabled,
    staff: file.staff,
    stage: file.stage,
    action: file.action,
    mentions: file.mentions,
    executable: file.executable,
    executables: file.executables,
    dutyTools: file.dutyTools,
    tickScript: file.tickScript,
    readsFrom: file.readsFrom,
    writesTo: file.writesTo,
  };
}

function toCommandEntry(file: CommandFile): CompanyCommandEntry {
  return {
    slug: file.slug,
    description: file.description,
    argumentHint: file.argumentHint,
    body: file.body,
  };
}

function toContextEntry(file: ContextFile): CompanyContextEntry {
  return {
    slug: file.slug,
    body: file.body,
    staff: file.staff,
  };
}

/** Read every executable folder into portable path→content maps. */
async function buildExecutableEntries(): Promise<CompanyExecutableEntry[]> {
  const summaries = await listExecutableFiles();
  const entries = await Promise.all(
    summaries.map(async (s) => {
      const files = await readExecutableFolderFiles(s.slug);
      return files ? { slug: s.slug, files } : null;
    }),
  );
  return entries.filter((e): e is NonNullable<typeof e> => e !== null);
}

/**
 * Read the portable engine-config slice from kody.config.json. Only fields
 * that are actually set are emitted, so an unconfigured repo exports `null`
 * rather than a bag of empties. The default branch is intentionally omitted —
 * it's repo-specific, not company-level.
 */
async function buildConfigBundle(): Promise<CompanyConfigBundle | null> {
  const { config } = await getEngineConfig(getOctokit(), getOwner(), getRepo());
  const out: CompanyConfigBundle = {};

  const quality: NonNullable<CompanyConfigBundle["quality"]> = {};
  for (const k of ["typecheck", "lint", "format", "testUnit"] as const) {
    const v = config.quality?.[k]?.trim();
    if (v) quality[k] = v;
  }
  if (Object.keys(quality).length > 0) out.quality = quality;

  if (config.aliases && Object.keys(config.aliases).length > 0) {
    out.aliases = config.aliases;
  }
  const assoc = config.access?.allowedAssociations;
  if (Array.isArray(assoc) && assoc.length > 0) out.allowedAssociations = assoc;
  if (config.defaultExecutable)
    out.defaultExecutable = config.defaultExecutable;
  if (config.defaultPrExecutable) {
    out.defaultPrExecutable = config.defaultPrExecutable;
  }
  const perExec = config.agent?.perExecutable;
  if (perExec && Object.keys(perExec).length > 0) out.perExecutable = perExec;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Read every company-level artifact from the connected repo and assemble
 * the portable bundle. The four reads are independent — fan them out.
 * Only repo-defined commands are exported (built-ins ship with the
 * dashboard, so re-importing them would be redundant).
 */
export async function buildCompanyBundle(): Promise<CompanyBundle> {
  const [
    staff,
    duties,
    contexts,
    commandsResult,
    executables,
    instructions,
    config,
  ] = await Promise.all([
    listStaffFiles(),
    listDutyFiles(),
    listContextFiles(),
    listRepoCommandFiles(),
    buildExecutableEntries(),
    readInstructionsFile(),
    buildConfigBundle(),
  ]);

  return {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: `${getOwner()}/${getRepo()}`,
    staff: staff.map(toTickEntry),
    duties: duties.map(toTickEntry),
    contexts: contexts.map(toContextEntry),
    commands: commandsResult.commands
      .filter((p) => p.source === "repo")
      .map(toCommandEntry),
    executables,
    instructions: instructions?.body?.trim() ? instructions.body : null,
    config,
  };
}
