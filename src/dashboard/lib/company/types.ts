/**
 * @fileType data
 * @domain kody
 * @pattern company-bundle
 * @ai-summary Portable "Company" bundle — the repo-agnostic operating
 *   manual of an org: its agent identities, context, commands
 *   (slash-command SOPs), capabilities, managed goals,
 *   and instructions (tone/behaviour).
 *   Deliberately excludes repo-specific state (memory, secrets,
 *   variables, dashboard config, generated activity, inbox, notifications) — those
 *   belong to the repo, not the company, and a company may span repos.
 *
 *   The bundle is a single JSON document the user exports from one repo
 *   and imports into another. Each entry stores only what round-trips
 *   through the existing file helpers (slug + metadata + body);
 *   repo-specific fields (sha, html_url, commit/tick timestamps) are
 *   dropped on export and re-derived on import.
 */

import { z } from "zod";
import { isManagedGoalState, type ManagedGoalState } from "../managed-goals";

/** Bump when the on-disk bundle shape changes incompatibly. */
export const COMPANY_BUNDLE_VERSION = 1 as const;

/**
 * A portable agent identity entry.
 */
export interface CompanyAgentEntry {
  slug: string;
  title: string;
  body: string;
}

/** A slash-command entry. */
export interface CompanyCommandEntry {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
}

/** A company context entry under `context/<slug>.md` in the state repo. */
export interface CompanyContextEntry {
  slug: string;
  body: string;
  agent: string[];
}

/**
 * A custom capability/action folder. Unlike the single-file concepts above,
 * these ship as a path→content map of every file under the state-repo folder.
 * Paths are relative to the folder.
 */
export interface CompanyCapabilityEntry {
  slug: string;
  files: Record<string, string>;
}

/** A managed company goal under `todos/<id>.json` in the configured Kody state repo. */
export interface CompanyGoalEntry {
  id: string;
  state: ManagedGoalState;
}

/**
 * The portable engine-config slice of a Company. Only repo-agnostic policy is
 * carried — quality commands, comment aliases, the `@kody` access gate,
 * capability defaults and model routing. The default branch
 * (`git.defaultBranch`) is deliberately excluded: it's repo-specific.
 */
export interface CompanyConfigBundle {
  quality?: {
    typecheck?: string;
    lint?: string;
    format?: string;
    testUnit?: string;
  };
  aliases?: Record<string, string>;
  allowedAssociations?: string[];
  defaultExecutable?: string;
  defaultPrExecutable?: string;
  perExecutable?: Record<string, string>;
}

/** The full portable bundle. */
export interface CompanyBundle {
  /** Format discriminator + version. */
  kodyCompany: typeof COMPANY_BUNDLE_VERSION;
  /** ISO 8601 timestamp the bundle was exported. */
  exportedAt: string;
  /** `owner/repo` the bundle was exported from (provenance only). */
  exportedFrom: string;
  agent: CompanyAgentEntry[];
  contexts: CompanyContextEntry[];
  commands: CompanyCommandEntry[];
  capabilities: CompanyCapabilityEntry[];
  goals: CompanyGoalEntry[];
  /** Repo instructions body, or `null` when the source repo had none. */
  instructions: string | null;
  /** Portable engine config (omitted by older bundles → `null`). */
  config: CompanyConfigBundle | null;
}

/** How an import resolves a slug/file that already exists on the target. */
export type CompanyImportMode = "skip" | "overwrite";

/** Per-collection tally returned by an import. */
export interface CompanyImportCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** What happened to the single instructions file on import. */
export type CompanyInstructionsOutcome =
  | "created"
  | "updated"
  | "skipped"
  | "absent";

/** What happened to the engine-config slice on import. `applied` = some field
 * was written; `skipped` = bundle had config but skip-mode left every field
 * (target already set them); `absent` = bundle carried no config. */
export type CompanyConfigOutcome = "applied" | "skipped" | "absent";

/** Structured result of applying a bundle to the target repo. */
export interface CompanyImportResult {
  mode: CompanyImportMode;
  agent: CompanyImportCounts;
  contexts: CompanyImportCounts;
  commands: CompanyImportCounts;
  capabilities: CompanyImportCounts;
  goals: CompanyImportCounts;
  instructions: CompanyInstructionsOutcome;
  config: CompanyConfigOutcome;
  /** Human-readable per-item notes (e.g. failures), newest last. */
  notes: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────
// Slugs match the ticked/command file rule: lowercase, digits, dash,
// underscore; 1–64 chars; must start with a letter or digit.
const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "invalid slug");

const agentEntrySchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  body: z.string().default(""),
});

const commandEntrySchema = z.object({
  slug: slugSchema,
  description: z.string().default(""),
  argumentHint: z.string().default(""),
  body: z.string().min(1),
});

const contextEntrySchema = z.object({
  slug: slugSchema,
  body: z.string().default(""),
  agent: z.array(z.string().min(1)).default([]),
});

const capabilityEntrySchema = z.object({
  slug: slugSchema,
  files: z.record(z.string(), z.string()),
});

const goalEntrySchema = z.object({
  id: slugSchema,
  state: z.custom<ManagedGoalState>(isManagedGoalState, "invalid goal state"),
});

/** Portable engine config. Every field optional + bounded; an unknown or
 * malformed shape is rejected so a junk bundle can't poison kody.config.json. */
const configBundleSchema = z.object({
  quality: z
    .object({
      typecheck: z.string().max(500).optional(),
      lint: z.string().max(500).optional(),
      format: z.string().max(500).optional(),
      testUnit: z.string().max(500).optional(),
    })
    .optional(),
  aliases: z.record(z.string().max(64), z.string().max(64)).optional(),
  allowedAssociations: z.array(z.string().max(40)).max(16).optional(),
  defaultExecutable: z.string().max(64).optional(),
  defaultPrExecutable: z.string().max(64).optional(),
  perExecutable: z.record(z.string().max(64), z.string().max(128)).optional(),
});

/**
 * Zod schema for an uploaded bundle. Tolerant of missing collections
 * (defaults to empty) but strict on the discriminator and entry shapes,
 * so a malformed or unrelated JSON file is rejected with a clear error.
 */
export const companyBundleSchema = z
  .object({
    kodyCompany: z.literal(COMPANY_BUNDLE_VERSION),
    exportedAt: z.string().optional(),
    exportedFrom: z.string().optional(),
    agent: z.array(agentEntrySchema).default([]),
    contexts: z.array(contextEntrySchema).default([]),
    commands: z.array(commandEntrySchema).optional(),
    /**
     * Legacy alias: bundles exported before the Prompts→Commands rename
     * stored this collection under `prompts`. Read it as a fallback so
     * older bundles still import their slash commands.
     */
    prompts: z.array(commandEntrySchema).optional(),
    capabilities: z.array(capabilityEntrySchema).default([]),
    goals: z.array(goalEntrySchema).default([]),
    instructions: z.string().nullable().default(null),
    config: configBundleSchema.nullish(),
  })
  .transform(({ prompts, commands, config, ...rest }) => ({
    ...rest,
    commands: commands ?? prompts ?? [],
    config: config ?? null,
  }));

export type ParsedCompanyBundle = z.infer<typeof companyBundleSchema>;
