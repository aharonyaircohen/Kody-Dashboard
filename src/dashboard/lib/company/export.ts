/**
 * @fileType util
 * @domain kody
 * @pattern company-export
 * @ai-summary Build a portable Company bundle from the connected repo.
 *   Reads the four company-level artifact types (staff, duties, commands,
 *   instructions) via their existing file helpers and maps each to the
 *   repo-agnostic shape in `types.ts` — dropping sha/html_url/commit and
 *   tick timestamps, which are meaningless in another repo. Runs inside
 *   an established GitHub context (see the API route).
 */

import { getOctokit, getOwner, getRepo } from "../github-client";
import { listDutyFiles } from "../duties-files";
import { listStaffFiles } from "../staff-files";
import { listRepoCommandFiles } from "../commands/files";
import { readInstructionsFile } from "../instructions/files";
import { listExecutableFiles, readExecutableFile } from "../executables";
import { getEngineConfig } from "../engine/config";
import {
  COMPANY_BUNDLE_VERSION,
  type CompanyBundle,
  type CompanyConfigBundle,
  type CompanyTickEntry,
  type CompanyCommandEntry,
  type CompanyExecutableEntry,
} from "./types";
import type { TickFile } from "../ticked/files";
import type { CommandFile } from "../commands/files";
import type { ExecutableDetail } from "../executables";

function toTickEntry(file: TickFile): CompanyTickEntry {
  return {
    slug: file.slug,
    title: file.title,
    body: file.body,
    schedule: file.schedule,
    disabled: file.disabled,
    staff: file.staff,
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

/** Flatten an executable folder into a portable path→content map. */
function toExecutableEntry(detail: ExecutableDetail): CompanyExecutableEntry {
  const files: Record<string, string> = {
    "profile.json": detail.profileJson,
    "prompt.md": detail.prompt,
  };
  for (const s of detail.shellScripts) files[s.name] = s.content;
  for (const s of detail.skills) files[`skills/${s.name}/SKILL.md`] = s.body;
  return { slug: detail.slug, files };
}

/** Read every executable folder into portable entries. */
async function buildExecutableEntries(): Promise<CompanyExecutableEntry[]> {
  const summaries = await listExecutableFiles();
  const details = await Promise.all(
    summaries.map((s) => readExecutableFile(s.slug)),
  );
  return details
    .filter((d): d is ExecutableDetail => d !== null)
    .map(toExecutableEntry);
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
  const [staff, duties, commandsResult, executables, instructions, config] =
    await Promise.all([
      listStaffFiles(),
      listDutyFiles(),
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
    commands: commandsResult.commands
      .filter((p) => p.source === "repo")
      .map(toCommandEntry),
    executables,
    instructions: instructions?.body?.trim() ? instructions.body : null,
    config,
  };
}
