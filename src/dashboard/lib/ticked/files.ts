/**
 * @fileType util
 * @domain kody
 * @pattern ticked-files
 * @ai-summary One implementation of the "ticked markdown file" store —
 *   read/write `<dir>/<slug>.md` via the GitHub contents API. Duties and
 *   staff are the same mechanism (a markdown file the engine's
 *   job-tick chain enumerates and ticks); they differ only by directory,
 *   commit scope, and which cache to invalidate. `createTickedFiles`
 *   binds those three and returns the file API; `duties-files.ts` /
 *   `staff-files.ts` are thin presets over it.
 *
 *   One file per definition. Path is the source of truth for identity
 *   (slug), file body is the markdown. Metadata (title, lastModified,
 *   sha) is derived from the file itself and the GitHub commit history
 *   is the audit trail — no labels, no issue tracker.
 */

import type { Octokit } from "@octokit/rest";
import {
  fetchCompanyActivity,
  getOctokit,
  getOwner,
  getRepo,
} from "../github-client";
import { STATE_BRANCH } from "../state-branch";
import {
  latestActivityByDuty,
  type CompanyActivityRecord,
} from "../activity/company";
import {
  joinFrontmatter,
  splitFrontmatter,
  type TickFrontmatter,
  type ScheduleEvery,
} from "./frontmatter";

export interface TickFile {
  /** Filename without `.md` — stable identity. */
  slug: string;
  /** First H1 of the body, or humanized slug fallback. */
  title: string;
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string;
  /** Git blob sha. Required for update/delete. Returned by reads only. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /**
   * Last visible tick time (ISO8601), from the state file or newer activity
   * log. `null` means the dashboard cannot see run proof.
   */
  lastTickAt: string | null;
  /**
   * UTC ISO timestamp at which this file will next be eligible to act,
   * read from `data.nextEligibleISO` in the state JSON. Each body instructs
   * the agent to emit this on every tick. `null` when unavailable.
   */
  nextEligibleAt: string | null;
  /**
   * Coarse result of the most recent tick, from state or activity. `null`
   * when unknown or running an engine that predates the field.
   */
  lastOutcome: "completed" | "failed" | null;
  /** Wall-clock of the most recent tick (ms) — `data.lastDurationMs`, or null. */
  lastDurationMs: number | null;
  /**
   * Per-file cadence, parsed from the frontmatter `every:` field.
   * `null` means "every cron wake" (the engine's 15-minute cron).
   * Engine-side gating ships separately — the dashboard always shows
   * whatever the file declares.
   */
  schedule: ScheduleEvery | null;
  /**
   * Mirrors `disabled: true` in the frontmatter. When `true` the engine
   * skips this file on every cron wake; manual triggers still fire. The
   * dashboard reads this to render the enable/disable toggle and the
   * "disabled" pill in list rows.
   */
  disabled: boolean;
  /**
   * Assigned staff member (persona) slug from the `staff:` frontmatter, or
   * `null` if none. Duty-only in practice — staff are personas and never
   * declare a staff member. The dashboard reads this to render/seed the
   * duty's staff picker; the engine scheduler skips duties with no staff.
   */
  staff: string | null;
  /**
   * GitHub logins this file's output should `@`-mention, parsed from the
   * `mentions:` frontmatter (comma-separated, no `@`). Empty array when the
   * key is absent. The dashboard reads it to render/seed the mentions input.
   */
  mentions: string[];
  /** Executable slugs assigned to this duty (`executables:` frontmatter). */
  executables: string[];
  /** Duty tool names from the engine-facing `tools:` frontmatter line. */
  dutyTools: string[];
  /** Optional tick script path (`tickScript:` frontmatter). */
  tickScript: string | null;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export interface TickWriteOptions {
  octokit: Octokit;
  slug: string;
  title: string;
  body: string;
  /**
   * Per-file cadence to emit in frontmatter. `null` (or absent) writes
   * no `every:` line, leaving the file on the global cron tick.
   */
  schedule?: ScheduleEvery | null;
  /**
   * When `true`, emits `disabled: true` in frontmatter so the scheduler
   * skips this file on every cron wake. Absent or `false` keeps it active.
   */
  disabled?: boolean;
  /**
   * Staff member (persona) slug to emit as `staff:` frontmatter. `null`/absent
   * writes no `staff:` line. Only duties set this; staff files never do.
   */
  staff?: string | null;
  /**
   * GitHub logins to emit as the `mentions:` frontmatter (comma-separated,
   * no `@`). Empty / absent writes no `mentions:` line.
   */
  mentions?: string[];
  /** Executable slugs to emit as `executables:` frontmatter. */
  executables?: string[];
  /** Duty tools to emit as `tools:` frontmatter. */
  dutyTools?: string[];
  /** Optional tick script path to emit as `tickScript:` frontmatter. */
  tickScript?: string | null;
  /** SHA of the existing blob; omit on create. */
  sha?: string;
  /** Commit message override. */
  message?: string;
}

/** Config that distinguishes one ticked-file kind (e.g. duties) from another. */
export interface TickedFilesConfig {
  /** Repo-relative directory holding the `.md` definitions. */
  dir: string;
  /** Conventional-commit scope used in generated commit messages. */
  commitScope: string;
  /** In-process cache invalidator for this kind. */
  invalidateCache: (slug?: string) => void;
}

export interface TickedFilesApi {
  listFiles(): Promise<TickFile[]>;
  readFile(slug: string): Promise<TickFile | null>;
  writeFile(opts: TickWriteOptions): Promise<TickFile>;
  deleteFile(octokit: Octokit, slug: string): Promise<void>;
  isValidSlug(slug: string): boolean;
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_"))
    return null;
  return slug;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function deriveTitle(body: string, slug: string): string {
  const firstLine = body.trimStart().split("\n", 1)[0] ?? "";
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (h1) return h1[1]!.trim();
  return slug
    .split(/[-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(" ");
}

function stripLeadingH1(body: string): string {
  // The first H1 is the title (rendered separately in the detail header).
  // Strip *every* leading H1 block — past round-trips could have prepended
  // the title multiple times, and any surviving leading H1 renders as a
  // duplicate title in the body card.
  //
  // Critically, skip leading blank lines before each check: the body handed
  // to us starts with the blank line that follows the frontmatter `---`, so
  // a naive `lines[0]` test sees "" and strips nothing.
  const lines = body.replace(/^﻿/, "").split("\n");
  let i = 0;
  for (;;) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i < lines.length && /^#\s+.+/.test(lines[i]!)) {
      i++;
    } else {
      break;
    }
  }
  return lines.slice(i).join("\n");
}

/**
 * Parse a raw ticked markdown file: split frontmatter, then derive title
 * and body from what remains. Title is the first H1 of the body or a
 * humanized slug; body is everything after the H1 (or the whole post-
 * frontmatter remainder).
 */
export function parseTickedMarkdown(
  raw: string,
  slug: string,
): { title: string; body: string; frontmatter: TickFrontmatter } {
  const { frontmatter, body: afterFm } = splitFrontmatter(raw);
  const body = stripLeadingH1(afterFm);
  const title = deriveTitle(afterFm, slug);
  return { title, body, frontmatter };
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  return data.default_branch;
}

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      per_page: 1,
    });
    return (
      data[0]?.commit.committer?.date ??
      data[0]?.commit.author?.date ??
      new Date().toISOString()
    );
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Like `fetchLastCommitDate` but returns `null` when the file has no
 * commits (i.e. it doesn't exist yet). Used for `<slug>.state.json`
 * which is created by the engine on first tick — absence means
 * "never ticked," not an error.
 */
async function fetchLastCommitDateOrNull(
  octokit: Octokit,
  filePath: string,
  ref?: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      // State files live on the state branch — look up their history there.
      ...(ref ? { sha: ref } : {}),
      per_page: 1,
    });
    if (data.length === 0) return null;
    return (
      data[0]?.commit.committer?.date ?? data[0]?.commit.author?.date ?? null
    );
  } catch {
    return null;
  }
}

export interface TickStateFields {
  /** `data.nextEligibleISO` — when the file next becomes eligible to act. */
  nextEligibleAt: string | null;
  /** `data.lastOutcome` — the engine stamps the agent's coarse result. */
  lastOutcome: "completed" | "failed" | null;
  /** `data.lastDurationMs` — wall-clock of the last agent run. */
  lastDurationMs: number | null;
}

const EMPTY_TICK_STATE: TickStateFields = {
  nextEligibleAt: null,
  lastOutcome: null,
  lastDurationMs: null,
};

/**
 * Fetch and parse `<slug>.state.json` for the dashboard-relevant fields the
 * engine stamps each tick: `nextEligibleISO` (cadence guard), and — since the
 * Phase 3 engine change — `lastOutcome` / `lastDurationMs` (the last run's
 * result + duration). One fetch + parse yields all three. Missing file or
 * fields → nulls.
 */
async function fetchTickState(
  octokit: Octokit,
  dir: string,
  slug: string,
): Promise<TickStateFields> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `${dir}/${slug}.state.json`,
      // Engine writes per-tick state to the dedicated state branch, not the
      // default branch (where the `.md` definition lives). 404 → never ran.
      ref: STATE_BRANCH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return EMPTY_TICK_STATE;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_TICK_STATE;
    const inner = (parsed as { data?: unknown }).data;
    if (!inner || typeof inner !== "object") return EMPTY_TICK_STATE;
    const d = inner as {
      nextEligibleISO?: unknown;
      lastOutcome?: unknown;
      lastDurationMs?: unknown;
    };
    return {
      nextEligibleAt:
        typeof d.nextEligibleISO === "string" && d.nextEligibleISO.length > 0
          ? d.nextEligibleISO
          : null,
      lastOutcome:
        d.lastOutcome === "completed" || d.lastOutcome === "failed"
          ? d.lastOutcome
          : null,
      lastDurationMs:
        typeof d.lastDurationMs === "number" ? d.lastDurationMs : null,
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return EMPTY_TICK_STATE;
    return EMPTY_TICK_STATE;
  }
}

const DUTY_ACTIVITY_DAY_FILES = 14;

async function fetchRecentDutyActivity(): Promise<
  Map<string, CompanyActivityRecord>
> {
  const records = await fetchCompanyActivity(1000, DUTY_ACTIVITY_DAY_FILES);
  return latestActivityByDuty(records);
}

function activityOutcome(
  rec: CompanyActivityRecord | undefined,
): "completed" | "failed" | null {
  if (rec?.outcome === "completed" || rec?.outcome === "failed")
    return rec.outcome;
  return null;
}

function isSameOrNewer(candidate: string, current: string | null): boolean {
  if (!current) return true;
  const candidateMs = new Date(candidate).getTime();
  const currentMs = new Date(current).getTime();
  if (Number.isNaN(candidateMs)) return false;
  if (Number.isNaN(currentMs)) return true;
  return candidateMs >= currentMs;
}

function buildFileContent(
  title: string,
  body: string,
  schedule: ScheduleEvery | null,
  disabled: boolean,
  staff: string | null,
  mentions: string[],
  executables: string[],
  dutyTools: string[],
  tickScript: string | null,
): string {
  // Strip any leading H1 the caller's body already carries so we never
  // double the title — `# ${title}` is the single canonical heading.
  const trimmedBody = stripLeadingH1(body.replace(/^\s+/, ""));
  const titled =
    trimmedBody.length > 0
      ? `# ${title.trim()}\n\n${trimmedBody}${trimmedBody.endsWith("\n") ? "" : "\n"}`
      : `# ${title.trim()}\n`;
  const fm: TickFrontmatter = {};
  if (schedule) fm.every = schedule;
  if (staff) fm.staff = staff;
  if (mentions.length > 0) fm.mentions = mentions;
  if (executables.length > 0) fm.executables = executables;
  if (dutyTools.length > 0) fm.dutyTools = dutyTools;
  if (tickScript?.trim()) fm.tickScript = tickScript.trim();
  if (disabled) fm.disabled = true;
  return joinFrontmatter(fm, titled);
}

/**
 * Bind a directory, commit scope, and cache invalidator to produce the
 * file API for one ticked-file kind. Duties and staff each call this
 * once with their own config.
 */
export function createTickedFiles(config: TickedFilesConfig): TickedFilesApi {
  const { dir, commitScope, invalidateCache } = config;

  function buildHtmlUrl(slug: string, branch: string | null): string {
    const ref = branch ?? "HEAD";
    return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${dir}/${slug}.md`;
  }

  /**
   * List every file under `<dir>/`. Returns `[]` if the directory does
   * not exist (fresh repo).
   */
  async function listFiles(): Promise<TickFile[]> {
    const octokit = getOctokit();
    const branch = await getDefaultBranch(octokit).catch(() => null);

    let entries: Array<{ name: string; sha: string; type: string }> = [];
    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: dir,
      });
      if (!Array.isArray(data)) return [];
      entries = data as Array<{ name: string; sha: string; type: string }>;
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 404) return [];
      throw error;
    }

    const slugs = entries
      .filter((e) => e.type === "file")
      .map((e) => ({ slug: slugFromName(e.name), sha: e.sha, name: e.name }))
      .filter(
        (e): e is { slug: string; sha: string; name: string } =>
          e.slug !== null,
      );

    // Build a set of slugs that have a sibling `.state.json` so we only
    // pay for a commit-history fetch when the engine has actually ticked
    // the file at least once. State files live on the dedicated state
    // branch, not here — list that branch's copy of the dir to find them.
    let stateEntries: Array<{ name: string; type: string }> = [];
    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: dir,
        ref: STATE_BRANCH,
      });
      if (Array.isArray(data))
        stateEntries = data as Array<{ name: string; type: string }>;
    } catch (error: unknown) {
      // 404 = state branch or dir doesn't exist yet (nothing ticked).
      if ((error as { status?: number })?.status !== 404) throw error;
    }
    const stateSlugs = new Set(
      stateEntries
        .filter((e) => e.type === "file" && e.name.endsWith(".state.json"))
        .map((e) => e.name.slice(0, -".state.json".length))
        .filter((s) => s.length > 0),
    );
    const activityByDuty =
      dir === ".kody/duties"
        ? await fetchRecentDutyActivity()
        : new Map<string, CompanyActivityRecord>();

    const files = await Promise.all(
      slugs.map(async ({ slug, sha, name }) => {
        try {
          const filePath = `${dir}/${name}`;
          const { data } = await octokit.repos.getContent({
            owner: getOwner(),
            repo: getRepo(),
            path: filePath,
          });
          if (Array.isArray(data) || !("content" in data) || !data.content)
            return null;
          const raw = Buffer.from(data.content, "base64").toString("utf-8");
          const { title, body, frontmatter } = parseTickedMarkdown(raw, slug);
          const hasState = stateSlugs.has(slug);
          const [updatedAt, lastTickAt, tickState] = await Promise.all([
            fetchLastCommitDate(octokit, filePath),
            hasState
              ? fetchLastCommitDateOrNull(
                  octokit,
                  `${dir}/${slug}.state.json`,
                  STATE_BRANCH,
                )
              : Promise.resolve(null),
            hasState
              ? fetchTickState(octokit, dir, slug)
              : Promise.resolve(EMPTY_TICK_STATE),
          ]);
          const activity = activityByDuty.get(slug);
          const useActivity =
            activity?.ts != null && isSameOrNewer(activity.ts, lastTickAt);
          return {
            slug,
            title,
            body,
            sha,
            updatedAt,
            lastTickAt: useActivity ? activity.ts : lastTickAt,
            nextEligibleAt: tickState.nextEligibleAt,
            lastOutcome: useActivity
              ? activityOutcome(activity)
              : tickState.lastOutcome,
            lastDurationMs: useActivity
              ? activity.durationMs
              : tickState.lastDurationMs,
            schedule: frontmatter.every ?? null,
            disabled: frontmatter.disabled === true,
            staff: frontmatter.staff ?? null,
            mentions: frontmatter.mentions ?? [],
            executables: frontmatter.executables ?? [],
            dutyTools: frontmatter.dutyTools ?? [],
            tickScript: frontmatter.tickScript ?? null,
            htmlUrl: buildHtmlUrl(slug, branch),
          } satisfies TickFile;
        } catch {
          return null;
        }
      }),
    );

    return files
      .filter((f): f is TickFile => f !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Read a single file by slug. Returns `null` if it does not exist.
   *
   * `octokitOverride` lets a caller (e.g. `writeFile`'s post-write confirm)
   * pin the read to a specific, known-good Octokit instead of the mutable
   * per-request global. This matters under concurrency: a parallel request's
   * `clearGitHubContext()` nulls the shared `_octokit`, after which
   * `getOctokit()` falls back to the env token and reads 401 ("Bad
   * credentials"). Passing the same octokit that performed the write keeps
   * the operation self-consistent.
   */
  async function readFile(
    slug: string,
    octokitOverride?: Octokit,
  ): Promise<TickFile | null> {
    if (!isValidSlug(slug)) return null;
    const octokit = octokitOverride ?? getOctokit();
    const branch = await getDefaultBranch(octokit).catch(() => null);
    const filePath = `${dir}/${slug}.md`;

    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: filePath,
      });
      if (Array.isArray(data) || !("content" in data) || !data.content)
        return null;
      const raw = Buffer.from(data.content, "base64").toString("utf-8");
      const { title, body, frontmatter } = parseTickedMarkdown(raw, slug);
      const [updatedAt, lastTickAt, tickState, activityByDuty] =
        await Promise.all([
          fetchLastCommitDate(octokit, filePath),
          fetchLastCommitDateOrNull(
            octokit,
            `${dir}/${slug}.state.json`,
            STATE_BRANCH,
          ),
          fetchTickState(octokit, dir, slug),
          dir === ".kody/duties"
            ? fetchRecentDutyActivity()
            : Promise.resolve(new Map<string, CompanyActivityRecord>()),
        ]);
      const activity = activityByDuty.get(slug);
      const useActivity =
        activity?.ts != null && isSameOrNewer(activity.ts, lastTickAt);
      return {
        slug,
        title,
        body,
        sha: data.sha,
        updatedAt,
        lastTickAt: useActivity ? activity.ts : lastTickAt,
        nextEligibleAt: tickState.nextEligibleAt,
        lastOutcome: useActivity
          ? activityOutcome(activity)
          : tickState.lastOutcome,
        lastDurationMs: useActivity
          ? activity.durationMs
          : tickState.lastDurationMs,
        schedule: frontmatter.every ?? null,
        disabled: frontmatter.disabled === true,
        staff: frontmatter.staff ?? null,
        mentions: frontmatter.mentions ?? [],
        executables: frontmatter.executables ?? [],
        dutyTools: frontmatter.dutyTools ?? [],
        tickScript: frontmatter.tickScript ?? null,
        htmlUrl: buildHtmlUrl(slug, branch),
      };
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 404) return null;
      throw error;
    }
  }

  /**
   * Create or update a file. Use `sha` for updates; omit for creates.
   * Returns the new TickFile record.
   */
  async function writeFile(opts: TickWriteOptions): Promise<TickFile> {
    if (!isValidSlug(opts.slug)) {
      throw new Error(
        `Invalid ${commitScope} slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
      );
    }
    const filePath = `${dir}/${opts.slug}.md`;
    const content = buildFileContent(
      opts.title,
      opts.body,
      opts.schedule ?? null,
      opts.disabled === true,
      opts.staff ?? null,
      opts.mentions ?? [],
      opts.executables ?? [],
      opts.dutyTools ?? [],
      opts.tickScript ?? null,
    );
    const message =
      opts.message ??
      `${opts.sha ? "chore" : "feat"}(${commitScope}): ${opts.sha ? "update" : "add"} ${opts.slug}`;

    await opts.octokit.repos.createOrUpdateFileContents({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: opts.sha,
    });

    invalidateCache(opts.slug);
    // Confirm with the SAME octokit that performed the write — never the
    // per-request global, which a concurrent request may have cleared
    // (→ env-token fallback → 401 "Bad credentials" on an otherwise
    // successful write). See readFile's `octokitOverride`.
    const refreshed = await readFile(opts.slug, opts.octokit);
    if (!refreshed) {
      throw new Error(
        `writeFile: ${commitScope} file was written but could not be re-read`,
      );
    }
    return refreshed;
  }

  /**
   * Delete a file. Idempotent on already-missing files (no-op).
   */
  async function deleteFile(octokit: Octokit, slug: string): Promise<void> {
    if (!isValidSlug(slug)) {
      throw new Error(`Invalid ${commitScope} slug: "${slug}".`);
    }
    const existing = await readFile(slug);
    if (!existing) return;
    const filePath = `${dir}/${slug}.md`;
    await octokit.repos.deleteFile({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      message: `chore(${commitScope}): remove ${slug}`,
      sha: existing.sha,
    });
    invalidateCache(slug);
  }

  return { listFiles, readFile, writeFile, deleteFile, isValidSlug };
}
