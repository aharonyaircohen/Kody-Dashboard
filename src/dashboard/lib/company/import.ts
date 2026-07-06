/**
 * @fileType util
 * @domain kody
 * @pattern company-import
 * @ai-summary Apply a portable Company bundle to the connected repo.
 *   Writes agents, Context, commands, capabilities,
 *   managed goals, and the single instructions file via their existing helpers.
 *   On a slug/file that already
 *   exists, `mode` decides: "skip" (default, non-destructive) leaves the
 *   target untouched; "overwrite" replaces it. Returns a structured
 *   per-collection tally so the UI can report created/updated/skipped/
 *   failed. Runs inside an established GitHub context with a user octokit
 *   that can commit (see the API route).
 */

import type { Octokit } from "@octokit/rest";
import { readAgentFile, writeAgentFile } from "../agent-files";
import { readCommandFile, writeCommandFile } from "../commands/files";
import { readContextFile, writeContextFile } from "../context/files";
import {
  readInstructionsFile,
  writeInstructionsFile,
} from "../instructions/files";
import {
  readCapabilityFolderFiles,
  writeCapabilityFolderFiles,
} from "../capabilities";
import {
  readManagedGoalFile,
  writeManagedGoalFile,
} from "../managed-goals-files";
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
  CompanyContextEntry,
  CompanyCapabilityEntry,
  CompanyGoalEntry,
  CompanyAgentEntry,
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
 * Import agent identities. For each entry: skip or overwrite if it already
 * exists, otherwise create. Failures are caught per-entry so one bad file
 * doesn't abort the whole import.
 */
async function importAgents(
  octokit: Octokit,
  entries: CompanyAgentEntry[],
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
        sha: existing?.sha,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`agent "${entry.slug}" failed: ${msg}`);
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

async function importContexts(
  octokit: Octokit,
  entries: CompanyContextEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      const existing = await readContextFile(entry.slug, octokit);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }
      await writeContextFile({
        octokit,
        slug: entry.slug,
        body: entry.body,
        agent: entry.agent,
        sha: existing?.sha,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`context "${entry.slug}" failed: ${msg}`);
    }
  }
  return counts;
}

/**
 * Import capabilities. Each entry is a folder (a path→content map); write the
 * whole folder exactly so nested scripts, templates, and helper files survive.
 */
async function importCapabilities(
  octokit: Octokit,
  entries: CompanyCapabilityEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      const profileJson = entry.files["profile.json"];
      if (!profileJson) {
        counts.failed++;
        notes.push(`capability "${entry.slug}" failed: missing profile.json`);
        continue;
      }
      const existing = await readCapabilityFolderFiles(entry.slug, octokit);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }

      await writeCapabilityFolderFiles({
        octokit,
        slug: entry.slug,
        files: entry.files,
        isUpdate: !!existing,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`capability "${entry.slug}" failed: ${msg}`);
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
async function importGoals(
  octokit: Octokit,
  entries: CompanyGoalEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  const owner = getOwner();
  const repo = getRepo();

  for (const entry of entries) {
    try {
      const existing = await readManagedGoalFile(
        entry.id,
        octokit,
        owner,
        repo,
      );
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }
      await writeManagedGoalFile({
        octokit,
        owner,
        repo,
        id: entry.id,
        state: entry.state,
        sha: existing?.sha,
        message: `chore(goals): import managed goal ${entry.id}`,
      });
      if (existing) counts.updated++;
      else counts.created++;
    } catch (err) {
      counts.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`goal "${entry.id}" failed: ${msg}`);
    }
  }

  return counts;
}

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
      defaultImplementation: !!existing?.defaultImplementation,
      defaultPrImplementation: !!existing?.defaultPrImplementation,
      perImplementation:
        !!existing?.agent?.perImplementation &&
        Object.keys(existing.agent.perImplementation).length > 0,
    };

    const patch: ConfigPatch = {};
    if (config.quality && !has.quality) patch.quality = config.quality;
    if (config.aliases && !has.aliases) patch.aliases = config.aliases;
    if (config.allowedAssociations && !has.allowedAssociations) {
      patch.allowedAssociations = config.allowedAssociations;
    }
    if (config.defaultImplementation && !has.defaultImplementation) {
      patch.defaultImplementation = config.defaultImplementation;
    }
    if (config.defaultPrImplementation && !has.defaultPrImplementation) {
      patch.defaultPrImplementation = config.defaultPrImplementation;
    }
    if (config.perImplementation && !has.perImplementation) {
      patch.perImplementation = config.perImplementation;
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
 * Apply a validated bundle to the connected repo.
 */
export async function applyCompanyBundle(
  octokit: Octokit,
  bundle: ParsedCompanyBundle,
  mode: CompanyImportMode,
): Promise<CompanyImportResult> {
  const notes: string[] = [];

  const agent = await importAgents(
    octokit,
    bundle.agent,
    mode,
    { read: readAgentFile, write: writeAgentFile },
    notes,
  );
  const contexts = await importContexts(octokit, bundle.contexts, mode, notes);
  const commands = await importCommands(octokit, bundle.commands, mode, notes);
  const capabilities = await importCapabilities(
    octokit,
    bundle.capabilities,
    mode,
    notes,
  );
  const goals = await importGoals(octokit, bundle.goals, mode, notes);

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

  // Config last: it may reference capabilities that the steps above just created.
  const config = await importConfig(octokit, bundle.config, mode, notes);

  return {
    mode,
    agent,
    contexts,
    commands,
    capabilities,
    goals,
    instructions,
    config,
    notes,
  };
}
