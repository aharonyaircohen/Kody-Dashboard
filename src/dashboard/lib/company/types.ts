/**
 * @fileType data
 * @domain kody
 * @pattern company-bundle
 * @ai-summary Portable "Company" bundle — the repo-agnostic operating
 *   manual of an org: its staff (personas), duties (recurring work),
 *   commands (slash-command SOPs), and instructions (tone/behaviour).
 *   Deliberately excludes repo-specific state (memory, secrets,
 *   variables, dashboard config, goals, inbox, notifications) — those
 *   belong to the repo, not the company, and a company may span repos.
 *
 *   The bundle is a single JSON document the user exports from one repo
 *   and imports into another. Each entry stores only what round-trips
 *   through the existing file helpers (slug + frontmatter + body);
 *   repo-specific fields (sha, html_url, commit/tick timestamps) are
 *   dropped on export and re-derived on import.
 */

import { z } from "zod";
import type { ScheduleEvery } from "../ticked/frontmatter";

/** Bump when the on-disk bundle shape changes incompatibly. */
export const COMPANY_BUNDLE_VERSION = 1 as const;

/** Cadence tokens accepted in a ticked-file's `every:` frontmatter. */
const SCHEDULE_TOKENS = [
  "15m",
  "30m",
  "1h",
  "2h",
  "6h",
  "12h",
  "1d",
  "3d",
  "7d",
  "manual",
] as const;

/**
 * A staff member or duty entry — both are "ticked markdown" files and
 * share the same portable shape. `staff` (the executor persona slug) is
 * only ever set on duties; staff files always carry `null`.
 */
export interface CompanyTickEntry {
  slug: string;
  title: string;
  body: string;
  schedule: ScheduleEvery | null;
  disabled: boolean;
  /** Executor persona slug — duties only; staff entries are always null. */
  staff: string | null;
}

/** A slash-command entry. */
export interface CompanyCommandEntry {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
}

/**
 * A custom executable. Unlike the single-file concepts above, an executable
 * is a *folder*, so it ships as a path→content map of every file under
 * `.kody/duties/<slug>/` (profile.json + prompt.md + optional `*.sh` +
 * optional `skills/<name>/SKILL.md`). Paths are relative to the folder.
 */
export interface CompanyExecutableEntry {
  slug: string;
  files: Record<string, string>;
}

/**
 * The portable engine-config slice of a Company. Only repo-agnostic policy is
 * carried — quality commands, comment aliases, the `@kody` access gate,
 * per-executable model routing, and the bare-`@kody` default executables
 * (slugs that resolve against the bundled executables). The default branch
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
  staff: CompanyTickEntry[];
  duties: CompanyTickEntry[];
  commands: CompanyCommandEntry[];
  executables: CompanyExecutableEntry[];
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
  staff: CompanyImportCounts;
  duties: CompanyImportCounts;
  commands: CompanyImportCounts;
  executables: CompanyImportCounts;
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

const tickEntrySchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  body: z.string().default(""),
  schedule: z.enum(SCHEDULE_TOKENS).nullable().default(null),
  disabled: z.boolean().default(false),
  staff: z.string().min(1).nullable().default(null),
});

const commandEntrySchema = z.object({
  slug: slugSchema,
  description: z.string().default(""),
  argumentHint: z.string().default(""),
  body: z.string().min(1),
});

const executableEntrySchema = z.object({
  slug: slugSchema,
  files: z.record(z.string(), z.string()),
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
    staff: z.array(tickEntrySchema).default([]),
    duties: z.array(tickEntrySchema).default([]),
    commands: z.array(commandEntrySchema).optional(),
    /**
     * Legacy alias: bundles exported before the Prompts→Commands rename
     * stored this collection under `prompts`. Read it as a fallback so
     * older bundles still import their slash commands.
     */
    prompts: z.array(commandEntrySchema).optional(),
    executables: z.array(executableEntrySchema).default([]),
    instructions: z.string().nullable().default(null),
    config: configBundleSchema.nullish(),
  })
  .transform(({ prompts, commands, config, ...rest }) => ({
    ...rest,
    commands: commands ?? prompts ?? [],
    config: config ?? null,
  }));

export type ParsedCompanyBundle = z.infer<typeof companyBundleSchema>;
