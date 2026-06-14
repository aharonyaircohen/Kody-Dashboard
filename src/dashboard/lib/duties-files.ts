/**
 * @fileType util
 * @domain kody
 * @pattern duties-files
 * @ai-summary Folder-backed duty store. A duty is a directory at
 *   `.kody/duties/<slug>/` with `profile.json` for metadata and `duty.md`
 *   for the human-readable why/output/limits body. The exported API matches
 *   the old markdown-file helper so routes/components can stay stable.
 */

import type { Octokit } from "@octokit/rest";
import {
  fetchCompanyActivity,
  getOctokit,
  getOwner,
  getRepo,
  invalidateDutiesCache,
} from "./github-client";
import { STATE_BRANCH } from "./state-branch";
import {
  latestActivityByDuty,
  type CompanyActivityRecord,
} from "./activity/company";
import {
  isScheduleEvery,
  type ScheduleEvery,
} from "./ticked/frontmatter";
import { parseTickedMarkdown, type TickFile, type TickWriteOptions } from "./ticked/files";

const DUTIES_DIR = ".kody/duties";
const PROFILE_FILE = "profile.json";
const BODY_FILE = "duty.md";

interface DutyProfile {
  name: string;
  action?: string;
  executable?: string;
  every?: ScheduleEvery;
  disabled?: boolean;
  runner?: string;
  /**
   * Engine-facing staff slug. Mirrors `runner` and is the field the engine
   * scheduler actually reads (`config.staff`). The dashboard writes both
   * for now; readers that pick `runner ?? staff` keep working.
   */
  staff?: string;
  reviewer?: string;
  mentions?: string[];
  executables?: string[];
  tools?: string[];
  tickScript?: string;
  readsFrom?: string[];
  writesTo?: string[];
  describe?: string;
}

export type DutyFile = TickFile;

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export function buildDutyBody(title: string, body: string): string {
  const stripped = stripLeadingH1(body.replace(/^\s+/, ""));
  return stripped.length > 0
    ? `# ${title.trim()}\n\n${stripped}${stripped.endsWith("\n") ? "" : "\n"}`
    : `# ${title.trim()}\n`;
}

export function buildDutyProfile(opts: TickWriteOptions): DutyProfile {
  const profile: DutyProfile = {
    name: opts.slug,
    describe: opts.title,
  };
  if (opts.action?.trim()) profile.action = opts.action.trim();
  if (opts.executable?.trim()) profile.executable = opts.executable.trim();
  if (opts.schedule) profile.every = opts.schedule;
  if (opts.disabled === true) profile.disabled = true;
  // The engine reads `config.staff`; mirror the typed value to BOTH
  // `staff` and `runner` in profile.json so existing readers (dashboard
  // UI, parsers that look for `runner`) keep working while the engine
  // finds the field it expects. `staff` wins when both are provided.
  const staffSlug = (opts.staff ?? opts.runner ?? "").trim();
  if (staffSlug) {
    profile.staff = staffSlug;
    profile.runner = staffSlug;
  }
  if (opts.reviewer?.trim()) profile.reviewer = cleanLogin(opts.reviewer);
  if (opts.mentions?.length) profile.mentions = cleanList(opts.mentions, true);
  if (opts.executables?.length) profile.executables = cleanList(opts.executables);
  if (opts.dutyTools?.length) profile.tools = cleanList(opts.dutyTools);
  if (opts.tickScript?.trim()) profile.tickScript = opts.tickScript.trim();
  if (opts.readsFrom?.length) profile.readsFrom = cleanList(opts.readsFrom);
  if (opts.writesTo?.length) profile.writesTo = cleanList(opts.writesTo);
  // Raw profile override — merged last. The keys this function manages
  // directly (identity + every typed field above) WIN: callers can't use
  // `extraProfile` to clobber them. The override is for ADDING fields the
  // typed schema doesn't expose (e.g. `version`, custom engine flags), or
  // for REPLACING values on keys we don't manage (pass `null` to clear).
  if (opts.extraProfile) {
    for (const [key, value] of Object.entries(opts.extraProfile)) {
      if (MANAGED_PROFILE_KEYS.has(key)) continue;
      (profile as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return profile;
}

/**
 * Profile.json keys `buildDutyProfile` writes from typed options. The raw
 * `extraProfile` override cannot clobber these — typed values always win.
 * Use the override to ADD new keys, not to replace typed ones. To clear a
 * typed value, pass the corresponding option as `null`/empty (e.g. omit
 * `staff` to remove the runner).
 */
const MANAGED_PROFILE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "describe",
  "action",
  "executable",
  "every",
  "disabled",
  "staff",
  "runner",
  "reviewer",
  "mentions",
  "executables",
  "tools",
  "tickScript",
  "readsFrom",
  "writesTo",
]);

function parseDutyProfile(raw: unknown, slug: string): DutyProfile {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: stringField(r.name) ?? slug,
    action: stringField(r.action),
    executable: stringField(r.executable),
    every: isScheduleEvery(r.every) ? r.every : undefined,
    disabled: typeof r.disabled === "boolean" ? r.disabled : undefined,
    runner: stringField(r.runner ?? r.staff),
    reviewer: cleanLoginField(r.reviewer),
    mentions: listField(r.mentions).map((m) => m.replace(/^@/, "")),
    executables: listField(r.executables),
    tools: listField(r.tools ?? r.dutyTools),
    tickScript: stringField(r.tickScript),
    readsFrom: listField(r.readsFrom ?? r.reads_from),
    writesTo: listField(r.writesTo ?? r.writes_to),
    describe: stringField(r.describe),
  };
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

interface TickStateFields {
  nextEligibleAt: string | null;
  lastOutcome: "completed" | "failed" | null;
  lastDurationMs: number | null;
}

const EMPTY_TICK_STATE: TickStateFields = {
  nextEligibleAt: null,
  lastOutcome: null,
  lastDurationMs: null,
};

async function fetchTickState(
  octokit: Octokit,
  slug: string,
): Promise<TickStateFields> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `${DUTIES_DIR}/${slug}.state.json`,
      ref: STATE_BRANCH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return EMPTY_TICK_STATE;
    const parsed: unknown = JSON.parse(
      Buffer.from(data.content, "base64").toString("utf-8"),
    );
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

async function fetchRecentDutyActivity(): Promise<
  Map<string, CompanyActivityRecord>
> {
  const records = await fetchCompanyActivity(1000, 14);
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

function buildHtmlUrl(slug: string, branch: string | null): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/tree/${ref}/${DUTIES_DIR}/${slug}`;
}

export async function listDutyFiles(): Promise<DutyFile[]> {
  const octokit = getOctokit();
  let entries: Array<{ name: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: DUTIES_DIR,
    });
    if (!Array.isArray(data)) return [];
    entries = data as Array<{ name: string; type: string }>;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }

  const duties = await Promise.all(
    entries
      .filter((e) => e.type === "dir" && isValidSlug(e.name))
      .map((e) => readDutyFile(e.name, octokit)),
  );
  return duties
    .filter((d): d is DutyFile => d !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function readDutyFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<DutyFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const profilePath = `${DUTIES_DIR}/${slug}/${PROFILE_FILE}`;
  const bodyPath = `${DUTIES_DIR}/${slug}/${BODY_FILE}`;

  try {
    const [profileResult, bodyResult, updatedAt, lastTickAt, tickState, activityByDuty] =
      await Promise.all([
        octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: profilePath,
        }),
        octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: bodyPath,
        }),
        fetchLastCommitDate(octokit, bodyPath),
        fetchLastCommitDateOrNull(
          octokit,
          `${DUTIES_DIR}/${slug}.state.json`,
          STATE_BRANCH,
        ),
        fetchTickState(octokit, slug),
        fetchRecentDutyActivity(),
      ]);
    const profileData = profileResult.data;
    const bodyData = bodyResult.data;
    if (
      Array.isArray(profileData) ||
      Array.isArray(bodyData) ||
      !("content" in profileData) ||
      !("content" in bodyData) ||
      !profileData.content ||
      !bodyData.content
    ) {
      return null;
    }
    const profile = parseDutyProfile(
      JSON.parse(Buffer.from(profileData.content, "base64").toString("utf-8")),
      slug,
    );
    const rawBody = Buffer.from(bodyData.content, "base64").toString("utf-8");
    const { title, body } = parseTickedMarkdown(rawBody, slug);
    const activity = activityByDuty.get(slug);
    const useActivity =
      activity?.ts != null && isSameOrNewer(activity.ts, lastTickAt);
    return {
      slug,
      title,
      body,
      sha: bodyData.sha,
      updatedAt,
      lastTickAt: useActivity ? activity.ts : lastTickAt,
      nextEligibleAt: tickState.nextEligibleAt,
      lastOutcome: useActivity
        ? activityOutcome(activity)
        : tickState.lastOutcome,
      lastDurationMs: useActivity ? activity.durationMs : tickState.lastDurationMs,
      schedule: profile.every ?? null,
      disabled: profile.disabled === true,
      runner: profile.runner ?? null,
      reviewer: profile.reviewer ?? null,
      action: profile.action ?? slug,
      mentions: profile.mentions ?? [],
      executable:
        profile.executable ??
        (profile.executables?.length === 1 ? profile.executables[0]! : null),
      executables:
        profile.executable || (profile.executables?.length ?? 0) !== 1
          ? (profile.executables ?? [])
          : [],
      dutyTools: profile.tools ?? [],
      tickScript: profile.tickScript ?? null,
      readsFrom: profile.readsFrom ?? [],
      writesTo: profile.writesTo ?? [],
      htmlUrl: buildHtmlUrl(slug, branch),
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export async function writeDutyFile(
  opts: TickWriteOptions,
): Promise<DutyFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid duties slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const profile = buildDutyProfile(opts);
  const body = buildDutyBody(opts.title, opts.body);
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(duties): ${opts.sha ? "update" : "add"} ${opts.slug}`;
  const legacyPath = `${DUTIES_DIR}/${opts.slug}.md`;
  const files: Array<{ path: string; content: string | null }> = [
    {
      path: `${DUTIES_DIR}/${opts.slug}/${PROFILE_FILE}`,
      content: `${JSON.stringify(profile, null, 2)}\n`,
    },
    {
      path: `${DUTIES_DIR}/${opts.slug}/${BODY_FILE}`,
      content: body,
    },
  ];
  if (await contentExists(opts.octokit, legacyPath)) {
    files.push({ path: legacyPath, content: null });
  }

  await writeTreeCommit(opts.octokit, message, files);

  invalidateDutiesCache(opts.slug);
  const refreshed = await readDutyFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error("writeDutyFile: duty folder was written but could not be re-read");
  }
  return refreshed;
}

export async function deleteDutyFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) throw new Error(`Invalid duties slug: "${slug}".`);
  const existing = await readDutyFile(slug, octokit);
  const legacyPath = `${DUTIES_DIR}/${slug}.md`;
  const hasLegacy = await contentExists(octokit, legacyPath);
  if (!existing && !hasLegacy) return;
  const files: Array<{ path: string; content: string | null }> = [];
  if (existing) {
    files.push(
      { path: `${DUTIES_DIR}/${slug}/${PROFILE_FILE}`, content: null },
      { path: `${DUTIES_DIR}/${slug}/${BODY_FILE}`, content: null },
    );
  }
  if (hasLegacy) files.push({ path: legacyPath, content: null });
  await writeTreeCommit(octokit, `chore(duties): remove ${slug}`, files);
  invalidateDutiesCache(slug);
}

async function contentExists(octokit: Octokit, filePath: string): Promise<boolean> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    return !Array.isArray(data) && "type" in data && data.type === "file";
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return false;
    throw error;
  }
}

async function writeTreeCommit(
  octokit: Octokit,
  message: string,
  files: Array<{ path: string; content: string | null }>,
): Promise<void> {
  const branch = await getDefaultBranch(octokit);
  const refName = `heads/${branch}`;
  const { data: ref } = await octokit.git.getRef({
    owner: getOwner(),
    repo: getRepo(),
    ref: refName,
  });
  const baseSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({
    owner: getOwner(),
    repo: getRepo(),
    commit_sha: baseSha,
  });
  const tree = await Promise.all(
    files.map(async (file) => {
      if (file.content === null) {
        return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: null };
      }
      const { data: blob } = await octokit.git.createBlob({
        owner: getOwner(),
        repo: getRepo(),
        content: file.content,
        encoding: "utf-8",
      });
      return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    }),
  );
  const { data: newTree } = await octokit.git.createTree({
    owner: getOwner(),
    repo: getRepo(),
    base_tree: baseCommit.tree.sha,
    tree,
  });
  const { data: commit } = await octokit.git.createCommit({
    owner: getOwner(),
    repo: getRepo(),
    message,
    tree: newTree.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({
    owner: getOwner(),
    repo: getRepo(),
    ref: refName,
    sha: commit.sha,
  });
}

function stripLeadingH1(body: string): string {
  const lines = body.replace(/^﻿/, "").split("\n");
  let i = 0;
  for (;;) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i < lines.length && /^#\s+.+/.test(lines[i]!)) i++;
    else break;
  }
  return lines.slice(i).join("\n");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function listField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") return cleanList(value.split(","));
  return [];
}

function cleanList(values: string[], stripAt = false): string[] {
  return values
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => (stripAt ? v.replace(/^@/, "") : v));
}

function cleanLogin(value: string): string {
  return value.trim().replace(/^@/, "");
}

function cleanLoginField(value: unknown): string | undefined {
  const raw = stringField(value);
  return raw ? cleanLogin(raw) : undefined;
}
