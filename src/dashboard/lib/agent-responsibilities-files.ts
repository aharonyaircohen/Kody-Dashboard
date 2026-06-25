/**
 * @fileType util
 * @domain kody
 * @pattern agentResponsibilities-files
 * @ai-summary Folder-backed agentResponsibility store. A agentResponsibility is a directory at
 *   `agent-responsibilities/<slug>/` in the state repo with `profile.json` for metadata
 *   and `agent-responsibility.md` for the human-readable why/output/limits body. The exported API matches
 *   the old markdown-file helper so routes/components can stay stable.
 */

import type { Octokit } from "@octokit/rest";
import {
  fetchCompanyActivity,
  getOctokit,
  getOwner,
  getRepo,
  invalidateAgentResponsibilitiesCache,
} from "./github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "./state-repo";
import {
  latestActivityByAgentResponsibility,
  type CompanyActivityRecord,
} from "./activity/company";
import {
  parseTickedMarkdown,
  type AgentResponsibilityCapabilityKind,
  type TickFile,
  type TickWriteOptions,
} from "./ticked/files";
import { isScheduleEvery, type ScheduleEvery } from "./ticked/frontmatter";
import {
  buildCompanyStoreHtmlUrl,
  companyStoreUpdatedAt,
  listCompanyStoreAssetSlugs,
  mergeAssetsBySlug,
  readCompanyStoreText,
} from "./company-store/assets";

const DUTIES_DIR = "agent-responsibilities";
const DUTIES_STATE_DIR = "agent-responsibilities";
const PROFILE_FILE = "profile.json";
const BODY_FILE = "agent-responsibility.md";

interface AgentResponsibilityProfile {
  name: string;
  action?: string;
  agentAction?: string;
  every?: ScheduleEvery;
  capabilityKind?: AgentResponsibilityCapabilityKind;
  disabled?: boolean;
  agent?: string;
  reviewer?: string;
  mentions?: string[];
  agentActions?: string[];
  tools?: string[];
  tickScript?: string;
  readsFrom?: string[];
  writesTo?: string[];
  describe?: string;
}

export type AgentResponsibilityFile = TickFile;

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export function buildAgentResponsibilityBody(
  title: string,
  body: string,
): string {
  const stripped = stripLeadingH1(body.replace(/^\s+/, ""));
  return stripped.length > 0
    ? `# ${title.trim()}\n\n${stripped}${stripped.endsWith("\n") ? "" : "\n"}`
    : `# ${title.trim()}\n`;
}

export function buildAgentResponsibilityProfile(
  opts: TickWriteOptions,
): AgentResponsibilityProfile {
  const profile: AgentResponsibilityProfile = {
    name: opts.slug,
    describe: opts.title,
  };
  if (opts.action?.trim()) profile.action = opts.action.trim();
  if (opts.agentAction?.trim()) profile.agentAction = opts.agentAction.trim();
  if (opts.schedule) profile.every = opts.schedule;
  if (opts.capabilityKind) profile.capabilityKind = opts.capabilityKind;
  if (opts.disabled === true) profile.disabled = true;
  const agentSlug = (opts.agent ?? "").trim();
  if (agentSlug) {
    profile.agent = agentSlug;
  }
  if (opts.reviewer?.trim()) profile.reviewer = cleanLogin(opts.reviewer);
  if (opts.mentions?.length) profile.mentions = cleanList(opts.mentions, true);
  if (opts.agentActions?.length)
    profile.agentActions = cleanList(opts.agentActions);
  if (opts.agentResponsibilityTools?.length)
    profile.tools = cleanList(opts.agentResponsibilityTools);
  if (opts.tickScript?.trim()) profile.tickScript = opts.tickScript.trim();
  if (opts.readsFrom?.length) profile.readsFrom = cleanList(opts.readsFrom);
  if (opts.writesTo?.length) profile.writesTo = cleanList(opts.writesTo);
  // Raw profile override — merged last. The keys this function manages
  // directly (identity + ignored legacy every field) WIN: callers can't use
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
 * Profile.json keys `buildAgentResponsibilityProfile` writes from typed options. The raw
 * `extraProfile` override cannot clobber these — typed values always win.
 * Use the override to ADD new keys, not to replace typed ones. To clear a
 * typed value, pass the corresponding option as `null`/empty (e.g. omit
 * `agent` to remove the agent).
 */
const MANAGED_PROFILE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "describe",
  "action",
  "agentAction",
  "capabilityKind",
  "every",
  "disabled",
  "agent",
  "reviewer",
  "mentions",
  "agentActions",
  "tools",
  "tickScript",
  "readsFrom",
  "writesTo",
]);

function parseAgentResponsibilityProfile(
  raw: unknown,
  slug: string,
): AgentResponsibilityProfile {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: stringField(r.name) ?? slug,
    action: stringField(r.action),
    agentAction: stringField(r.agentAction),
    every: isScheduleEvery(r.every) ? r.every : undefined,
    capabilityKind: agentResponsibilityCapabilityKindField(r.capabilityKind),
    disabled: typeof r.disabled === "boolean" ? r.disabled : undefined,
    agent: stringField(r.agent),
    reviewer: cleanLoginField(r.reviewer),
    mentions: listField(r.mentions).map((m) => m.replace(/^@/, "")),
    agentActions: listField(r.agentActions),
    tools: listField(r.tools ?? r.agentResponsibilityTools),
    tickScript: stringField(r.tickScript),
    readsFrom: listField(r.readsFrom ?? r.reads_from),
    writesTo: listField(r.writesTo ?? r.writes_to),
    describe: stringField(r.describe),
  };
}

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, filePath),
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

function agentResponsibilityStatePath(slug: string): string {
  return `${DUTIES_STATE_DIR}/${slug}/state.json`;
}

async function fetchStateLastCommitDate(
  octokit: Octokit,
  slug: string,
): Promise<string | null> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, agentResponsibilityStatePath(slug)),
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
    const file = await readStateText(
      octokit,
      getOwner(),
      getRepo(),
      agentResponsibilityStatePath(slug),
      {
        headers: { "If-None-Match": "" },
      },
    );
    if (!file) return EMPTY_TICK_STATE;
    const parsed: unknown = JSON.parse(file.content);
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

async function fetchRecentAgentResponsibilityActivity(): Promise<
  Map<string, CompanyActivityRecord>
> {
  const records = await fetchCompanyActivity(1000, 14);
  return latestActivityByAgentResponsibility(records);
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

export async function listLocalAgentResponsibilityFiles(): Promise<
  AgentResponsibilityFile[]
> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    DUTIES_DIR,
    { headers: { "If-None-Match": "" } },
  );
  const agentResponsibilities = await Promise.all(
    entries
      .filter((e) => e.type === "dir" && isValidSlug(e.name))
      .map((e) => readAgentResponsibilityFile(e.name, octokit)),
  );
  return agentResponsibilities.filter(
    (d): d is AgentResponsibilityFile => d !== null,
  );
}

export async function listAgentResponsibilityFiles(): Promise<
  AgentResponsibilityFile[]
> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    DUTIES_DIR,
    { headers: { "If-None-Match": "" } },
  );

  const agentResponsibilities = await Promise.all(
    entries
      .filter((e) => e.type === "dir" && isValidSlug(e.name))
      .map((e) => readAgentResponsibilityFile(e.name, octokit)),
  );
  const local = agentResponsibilities.filter(
    (d): d is AgentResponsibilityFile => d !== null,
  );
  const store = await listStoreAgentResponsibilityFiles(
    octokit,
    new Set(local.map((d) => d.slug)),
  );
  return mergeAssetsBySlug(local, store);
}

async function listStoreAgentResponsibilityFiles(
  octokit: Octokit,
  localSlugs: Set<string>,
): Promise<AgentResponsibilityFile[]> {
  const slugs = await listCompanyStoreAssetSlugs(
    octokit,
    "agent-responsibilities",
    isValidSlug,
  );
  const agentResponsibilities = await Promise.all(
    slugs
      .filter((slug) => !localSlugs.has(slug))
      .map((slug) => readStoreAgentResponsibilityFile(slug, octokit)),
  );
  return agentResponsibilities.filter(
    (d): d is AgentResponsibilityFile => d !== null,
  );
}

export async function readResolvedAgentResponsibilityFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentResponsibilityFile | null> {
  const local = await readAgentResponsibilityFile(slug, octokitOverride);
  if (local) return local;
  return readStoreAgentResponsibilityFile(
    slug,
    octokitOverride ?? getOctokit(),
  );
}

export async function readAgentResponsibilityFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentResponsibilityFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const profilePath = `${DUTIES_DIR}/${slug}/${PROFILE_FILE}`;
  const bodyPath = `${DUTIES_DIR}/${slug}/${BODY_FILE}`;

  try {
    const [
      profileResult,
      bodyResult,
      updatedAt,
      lastTickAt,
      tickState,
      activityByAgentResponsibility,
    ] = await Promise.all([
      readStateText(octokit, getOwner(), getRepo(), profilePath, {
        headers: { "If-None-Match": "" },
      }),
      readStateText(octokit, getOwner(), getRepo(), bodyPath, {
        headers: { "If-None-Match": "" },
      }),
      fetchLastCommitDate(octokit, bodyPath),
      fetchStateLastCommitDate(octokit, slug),
      fetchTickState(octokit, slug),
      fetchRecentAgentResponsibilityActivity(),
    ]);
    if (!profileResult || !bodyResult) return null;
    const profile = parseAgentResponsibilityProfile(
      JSON.parse(profileResult.content),
      slug,
    );
    const rawBody = bodyResult.content;
    const { title, body } = parseTickedMarkdown(rawBody, slug);
    const activity = activityByAgentResponsibility.get(slug);
    const useActivity =
      activity?.ts != null && isSameOrNewer(activity.ts, lastTickAt);
    return {
      slug,
      title,
      body,
      sha: bodyResult.sha,
      updatedAt,
      lastTickAt: useActivity ? activity.ts : lastTickAt,
      nextEligibleAt: tickState.nextEligibleAt,
      lastOutcome: useActivity
        ? activityOutcome(activity)
        : tickState.lastOutcome,
      lastDurationMs: useActivity
        ? activity.durationMs
        : tickState.lastDurationMs,
      schedule: profile.every ?? null,
      capabilityKind: profile.capabilityKind ?? null,
      disabled: profile.disabled === true,
      agent: profile.agent ?? null,
      reviewer: profile.reviewer ?? null,
      action: profile.action ?? slug,
      mentions: profile.mentions ?? [],
      agentAction:
        profile.agentAction ??
        (profile.agentActions?.length === 1 ? profile.agentActions[0]! : null),
      agentActions:
        profile.agentAction || (profile.agentActions?.length ?? 0) !== 1
          ? (profile.agentActions ?? [])
          : [],
      agentResponsibilityTools: profile.tools ?? [],
      tickScript: profile.tickScript ?? null,
      readsFrom: profile.readsFrom ?? [],
      writesTo: profile.writesTo ?? [],
      htmlUrl: bodyResult.htmlUrl ?? "",
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

async function readStoreAgentResponsibilityFile(
  slug: string,
  octokit: Octokit,
): Promise<AgentResponsibilityFile | null> {
  if (!isValidSlug(slug)) return null;
  const profilePath = `.kody/agent-responsibilities/${slug}/${PROFILE_FILE}`;
  const bodyPath = `.kody/agent-responsibilities/${slug}/${BODY_FILE}`;
  const [profileRaw, rawBody, updatedAt] = await Promise.all([
    readCompanyStoreText(octokit, profilePath),
    readCompanyStoreText(octokit, bodyPath),
    companyStoreUpdatedAt(octokit, "agent-responsibilities", slug),
  ]);
  if (!profileRaw || rawBody === null) return null;
  const profile = parseAgentResponsibilityProfile(JSON.parse(profileRaw), slug);
  const { title, body } = parseTickedMarkdown(rawBody, slug);
  return {
    slug,
    title,
    body,
    sha: "",
    updatedAt,
    lastTickAt: null,
    nextEligibleAt: null,
    lastOutcome: null,
    lastDurationMs: null,
    schedule: profile.every ?? null,
    capabilityKind: profile.capabilityKind ?? null,
    disabled: profile.disabled === true,
    agent: profile.agent ?? null,
    reviewer: profile.reviewer ?? null,
    action: profile.action ?? slug,
    mentions: profile.mentions ?? [],
    agentAction: profile.agentAction ?? null,
    agentActions: profile.agentActions ?? [],
    agentResponsibilityTools: profile.tools ?? [],
    tickScript: profile.tickScript ?? null,
    readsFrom: profile.readsFrom ?? [],
    writesTo: profile.writesTo ?? [],
    htmlUrl: buildCompanyStoreHtmlUrl("agent-responsibilities", slug),
    source: "store",
    readOnly: true,
  };
}

export async function writeAgentResponsibilityFile(
  opts: TickWriteOptions,
): Promise<AgentResponsibilityFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid agentResponsibilities slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const owner = getOwner();
  const repo = getRepo();
  const profilePath = `${DUTIES_DIR}/${opts.slug}/${PROFILE_FILE}`;
  const bodyPath = `${DUTIES_DIR}/${opts.slug}/${BODY_FILE}`;
  const existingProfile = await readStateText(
    opts.octokit,
    owner,
    repo,
    profilePath,
  );
  const profile = buildAgentResponsibilityProfile(opts);
  const body = buildAgentResponsibilityBody(opts.title, opts.body);
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(agentResponsibilities): ${opts.sha ? "update" : "add"} ${opts.slug}`;
  await writeStateText({
    octokit: opts.octokit,
    owner,
    repo,
    path: profilePath,
    message,
    content: `${JSON.stringify(profile, null, 2)}\n`,
    sha: existingProfile?.sha,
  });
  await writeStateText({
    octokit: opts.octokit,
    owner,
    repo,
    path: bodyPath,
    message,
    content: body,
    sha: opts.sha,
  });

  invalidateAgentResponsibilitiesCache(opts.slug);
  const refreshed = await readAgentResponsibilityFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeAgentResponsibilityFile: agentResponsibility folder was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteAgentResponsibilityFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug))
    throw new Error(`Invalid agentResponsibilities slug: "${slug}".`);
  const existing = await readAgentResponsibilityFile(slug, octokit);
  if (!existing) return;
  const message = `chore(agentResponsibilities): remove ${slug}`;
  await deleteStatePathIfExists(
    octokit,
    `${DUTIES_DIR}/${slug}/${PROFILE_FILE}`,
    message,
  );
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: `${DUTIES_DIR}/${slug}/${BODY_FILE}`,
    message,
    sha: existing.sha,
  });
  invalidateAgentResponsibilitiesCache(slug);
}
async function deleteStatePathIfExists(
  octokit: Octokit,
  filePath: string,
  message: string,
): Promise<void> {
  const file = await readStateText(octokit, getOwner(), getRepo(), filePath);
  if (!file) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    sha: file.sha,
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

function agentResponsibilityCapabilityKindField(
  value: unknown,
): AgentResponsibilityCapabilityKind | undefined {
  return value === "observe" || value === "act" || value === "verify"
    ? value
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
