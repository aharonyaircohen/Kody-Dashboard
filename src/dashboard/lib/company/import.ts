/**
 * @fileType util
 * @domain kody
 * @pattern company-import
 * @ai-summary Apply a portable Company bundle to the connected repo.
 *   Writes staff, duties, and commands via their existing file helpers,
 *   plus the single instructions file. On a slug/file that already
 *   exists, `mode` decides: "skip" (default, non-destructive) leaves the
 *   target untouched; "overwrite" replaces it. Returns a structured
 *   per-collection tally so the UI can report created/updated/skipped/
 *   failed. Runs inside an established GitHub context with a user octokit
 *   that can commit (see the API route).
 */

import type { Octokit } from "@octokit/rest";
import { readDutyFile, writeDutyFile } from "../duties-files";
import { readStaffFile, writeStaffFile } from "../staff-files";
import { readCommandFile, writeCommandFile } from "../commands/files";
import {
  readInstructionsFile,
  writeInstructionsFile,
} from "../instructions/files";
import {
  readExecutableFile,
  writeExecutableFile,
  fieldsFromProfile,
} from "../executables";
import { getOwner, getRepo } from "../github-client";
import {
  getEngineConfig,
  writeConfigPatch,
  type ConfigPatch,
} from "../engine/config";
import type { TickFile } from "../ticked/files";
import type { TickWriteOptions } from "../ticked/files";
import type {
  CompanyConfigBundle,
  CompanyConfigOutcome,
  CompanyImportCounts,
  CompanyImportMode,
  CompanyImportResult,
  CompanyCommandEntry,
  CompanyExecutableEntry,
  CompanyTickEntry,
  ParsedCompanyBundle,
} from "./types";

function emptyCounts(): CompanyImportCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

interface TickWriter {
  read: (slug: string, octokit?: Octokit) => Promise<TickFile | null>;
  write: (opts: TickWriteOptions) => Promise<TickFile>;
}

/**
 * Import one ticked collection (staff or duties). For each entry: skip or
 * overwrite if it already exists, otherwise create. Failures are caught
 * per-entry so one bad file doesn't abort the whole import.
 */
async function importTickCollection(
  octokit: Octokit,
  label: string,
  entries: CompanyTickEntry[],
  mode: CompanyImportMode,
  writer: TickWriter,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      // Pin the existence check to the SAME user octokit as the write — the
      // per-request global may be cleared by a concurrent request mid-import
      // (→ env-token fallback → 401 "Bad credentials" on every entry after).
      const existing = await writer.read(entry.slug, octokit);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }
      await writer.write({
        octokit,
        slug: entry.slug,
        title: entry.title,
        body: entry.body,
        schedule: entry.schedule,
        disabled: entry.disabled,
        staff: entry.staff,
        // New engine duty contract (kody2 main). Carry verbatim so a
        // bundle round-trips through export/import without losing the
        // engine's new frontmatter fields. Staff entries never set them
        // (their on-disk serializer omits empty arrays), so it's safe
        // to pass empty arrays through.
        mentions: entry.mentions,
        executables: entry.executables,
        dutyTools: entry.dutyTools,
        tickScript: entry.tickScript,
        sha: existing?.sha,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`${label} "${entry.slug}" failed: ${msg}`);
    }
  }
  return counts;
}

async function importCommands(
  octokit: Octokit,
  entries: CompanyCommandEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      const existing = await readCommandFile(entry.slug, octokit);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }
      await writeCommandFile({
        octokit,
        slug: entry.slug,
        description: entry.description,
        argumentHint: entry.argumentHint,
        body: entry.body,
        sha: existing?.sha,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`command "${entry.slug}" failed: ${msg}`);
    }
  }
  return counts;
}

/**
 * Import executables. Each entry is a folder (a path→content map); we
 * reconstruct the writer inputs from it and commit the whole folder
 * atomically via `writeExecutableFile`, preserving the original
 * profile.json verbatim (`profileJsonOverride`).
 */
async function importExecutables(
  octokit: Octokit,
  entries: CompanyExecutableEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      const profileJson = entry.files["profile.json"];
      if (!profileJson) {
        counts.failed++;
        notes.push(`executable "${entry.slug}" failed: missing profile.json`);
        continue;
      }
      const existing = await readExecutableFile(entry.slug, octokit);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }

      const prompt = entry.files["prompt.md"] ?? "";
      const shellScripts = Object.entries(entry.files)
        .filter(([p]) => /^[^/]+\.sh$/.test(p))
        .map(([name, content]) => ({ name, content }));
      const skills = Object.entries(entry.files)
        .map(([p, body]) => {
          const m = p.match(/^skills\/([^/]+)\/SKILL\.md$/);
          return m ? { name: m[1], body } : null;
        })
        .filter((s): s is { name: string; body: string } => s !== null);

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(profileJson) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const fields = fieldsFromProfile(entry.slug, parsed);

      await writeExecutableFile({
        octokit,
        fields: { ...fields, prompt },
        skills,
        shellScripts,
        profileJsonOverride: profileJson,
        removedSkills: existing
          ? existing.skills
              .map((s) => s.name)
              .filter((n) => !skills.some((s) => s.name === n))
          : [],
        removedShellScripts: existing
          ? existing.shellScripts
              .map((s) => s.name)
              .filter((n) => !shellScripts.some((s) => s.name === n))
          : [],
        isUpdate: !!existing,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`executable "${entry.slug}" failed: ${msg}`);
    }
  }
  return counts;
}

/**
 * Apply the portable engine-config slice to kody.config.json in one commit.
 * In `overwrite` mode every present field is written; in `skip` mode a field
 * is only written when the target doesn't already have it (so an import never
 * clobbers a deliberately-set value). Returns "absent" when the bundle carried
 * no config, "skipped" when skip-mode left every field, else "applied".
 */
async function importConfig(
  octokit: Octokit,
  config: CompanyConfigBundle | null,
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyConfigOutcome> {
  if (!config || Object.keys(config).length === 0) return "absent";

  try {
    const owner = getOwner();
    const repo = getRepo();
    // In skip mode we need the target's current values to leave set fields be.
    const existing =
      mode === "skip"
        ? (await getEngineConfig(octokit, owner, repo, { force: true })).config
        : null;

    const has = {
      quality:
        !!existing?.quality &&
        Object.values(existing.quality).some((v) => v?.trim()),
      aliases: !!existing?.aliases && Object.keys(existing.aliases).length > 0,
      allowedAssociations:
        Array.isArray(existing?.access?.allowedAssociations) &&
        existing.access.allowedAssociations.length > 0,
      defaultExecutable: !!existing?.defaultExecutable,
      defaultPrExecutable: !!existing?.defaultPrExecutable,
      perExecutable:
        !!existing?.agent?.perExecutable &&
        Object.keys(existing.agent.perExecutable).length > 0,
    };

    const patch: ConfigPatch = {};
    if (config.quality && !has.quality) patch.quality = config.quality;
    if (config.aliases && !has.aliases) patch.aliases = config.aliases;
    if (config.allowedAssociations && !has.allowedAssociations) {
      patch.allowedAssociations = config.allowedAssociations;
    }
    if (config.defaultExecutable && !has.defaultExecutable) {
      patch.defaultExecutable = config.defaultExecutable;
    }
    if (config.defaultPrExecutable && !has.defaultPrExecutable) {
      patch.defaultPrExecutable = config.defaultPrExecutable;
    }
    if (config.perExecutable && !has.perExecutable) {
      patch.perExecutable = config.perExecutable;
    }

    if (Object.keys(patch).length === 0) return "skipped";

    await writeConfigPatch(
      octokit,
      owner,
      repo,
      patch,
      "chore(kody): import company config",
    );
    return "applied";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`config failed: ${msg}`);
    return "absent";
  }
}

/**
 * Apply a validated bundle to the connected repo. Staff first, then
 * duties — so a duty that names a staff member lands after its executor
 * exists (cosmetic ordering; the engine resolves at tick time regardless).
 */
export async function applyCompanyBundle(
  octokit: Octokit,
  bundle: ParsedCompanyBundle,
  mode: CompanyImportMode,
): Promise<CompanyImportResult> {
  const notes: string[] = [];

  const staff = await importTickCollection(
    octokit,
    "staff",
    bundle.staff,
    mode,
    { read: readStaffFile, write: writeStaffFile },
    notes,
  );
  const duties = await importTickCollection(
    octokit,
    "duty",
    bundle.duties,
    mode,
    { read: readDutyFile, write: writeDutyFile },
    notes,
  );
  const commands = await importCommands(octokit, bundle.commands, mode, notes);
  const executables = await importExecutables(
    octokit,
    bundle.executables,
    mode,
    notes,
  );

  let instructions: CompanyImportResult["instructions"] = "absent";
  if (bundle.instructions && bundle.instructions.trim().length > 0) {
    try {
      const existing = await readInstructionsFile(octokit);
      if (existing && mode === "skip") {
        instructions = "skipped";
      } else {
        await writeInstructionsFile({
          octokit,
          body: bundle.instructions,
          sha: existing?.sha,
        });
        instructions = existing ? "updated" : "created";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`instructions failed: ${msg}`);
    }
  }

  // Config last: it may reference executables (default*Executable slugs) that
  // the steps above just created.
  const config = await importConfig(octokit, bundle.config, mode, notes);

  return {
    mode,
    staff,
    duties,
    commands,
    executables,
    instructions,
    config,
    notes,
  };
}
