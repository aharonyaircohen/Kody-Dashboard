/**
 * @fileType util
 * @domain kody
 * @pattern company-import
 * @ai-summary Apply a portable Company bundle to the connected repo.
 *   Writes staff, duties, and prompts via their existing file helpers,
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
import { readPromptFile, writePromptFile } from "../prompts/files";
import {
  readInstructionsFile,
  writeInstructionsFile,
} from "../instructions/files";
import type { TickFile } from "../ticked/files";
import type { TickWriteOptions } from "../ticked/files";
import type {
  CompanyImportCounts,
  CompanyImportMode,
  CompanyImportResult,
  CompanyPromptEntry,
  CompanyTickEntry,
  ParsedCompanyBundle,
} from "./types";

function emptyCounts(): CompanyImportCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

interface TickWriter {
  read: (slug: string) => Promise<TickFile | null>;
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
      const existing = await writer.read(entry.slug);
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

async function importPrompts(
  octokit: Octokit,
  entries: CompanyPromptEntry[],
  mode: CompanyImportMode,
  notes: string[],
): Promise<CompanyImportCounts> {
  const counts = emptyCounts();
  for (const entry of entries) {
    try {
      const existing = await readPromptFile(entry.slug);
      if (existing && mode === "skip") {
        counts.skipped++;
        continue;
      }
      await writePromptFile({
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
      notes.push(`prompt "${entry.slug}" failed: ${msg}`);
    }
  }
  return counts;
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
  const prompts = await importPrompts(octokit, bundle.prompts, mode, notes);

  let instructions: CompanyImportResult["instructions"] = "absent";
  if (bundle.instructions && bundle.instructions.trim().length > 0) {
    try {
      const existing = await readInstructionsFile();
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

  return { mode, staff, duties, prompts, instructions, notes };
}
