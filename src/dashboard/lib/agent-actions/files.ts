/**
 * @fileType util
 * @domain agentActions
 * @pattern agentActions-files
 * @ai-summary Read/write custom agentActions under
 *   `agent-actions/<slug>/` in the configured Kody state repo. An agentAction is a *folder*
 *   (profile.json + prompt.md + optional `*.sh` + optional
 *   `skills/<name>/SKILL.md`), so unlike the single-file commands/agent-responsibilities
 *   helpers this commits the whole folder atomically using the Git Data
 *   API (one blob per file → one tree → one commit).
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  type StateRepoTarget,
} from "../state-repo";
import {
  appendContract,
  composeProfile,
  fieldsFromProfile,
  isValidSlug,
  isCapabilityKind,
  serializeProfile,
  stripContract,
  type AgentActionFields,
  type AgentActionLanding,
  type CapabilityKind,
  type McpServerSpec,
  DEFAULT_CAPABILITY_KIND,
} from "./profile";
import {
  buildCompanyStoreHtmlUrl,
  listCompanyStoreAssetSlugs,
  listCompanyStoreDirectorySafe,
  mergeAssetsBySlug,
  readCompanyStoreText,
} from "../company-store/assets";

export { isValidSlug } from "./profile";

/**
 * Custom agentActions live at `agent-actions/<slug>/` in the state repo. All reads and
 * writes go through this single home.
 */
const EXECUTABLES_DIR = "agent-actions";
const CAPABILITIES_DIR = "capabilities";
const AGENT_ACTION_BODY_FILE = "prompt.md";
const CAPABILITY_BODY_FILE = "capability.md";

interface AgentActionStorage {
  dir: typeof EXECUTABLES_DIR | typeof CAPABILITIES_DIR;
  bodyFile: typeof AGENT_ACTION_BODY_FILE | typeof CAPABILITY_BODY_FILE;
  storeKind: "agent-actions" | "capabilities";
  commitScope: "agentAction" | "capability";
  conceptName: "agentAction" | "capability";
}

const AGENT_ACTION_STORAGE: AgentActionStorage = {
  dir: EXECUTABLES_DIR,
  bodyFile: AGENT_ACTION_BODY_FILE,
  storeKind: "agent-actions",
  commitScope: "agentAction",
  conceptName: "agentAction",
};

const CAPABILITY_STORAGE: AgentActionStorage = {
  dir: CAPABILITIES_DIR,
  bodyFile: CAPABILITY_BODY_FILE,
  storeKind: "capabilities",
  commitScope: "capability",
  conceptName: "capability",
};

export interface AgentActionSkill {
  /** Skill folder name under `skills/`. */
  name: string;
  /** `SKILL.md` contents. */
  body: string;
}

export interface AgentActionShellScript {
  /** `.sh` filename (e.g. `setup.sh`). */
  name: string;
  /** Script contents. */
  content: string;
}

export interface AgentActionSummary {
  slug: string;
  describe: string;
  capabilityKind: CapabilityKind;
  landing: AgentActionLanding;
  /** Last-commit date; null in the list view (per-agentResponsibility lookups are rate-limited). */
  updatedAt: string | null;
  htmlUrl: string;
  /** Agent member this agentResponsibility runs as (profile.agent), or null. */
  agent: string | null;
  /** Recurrence cadence from profile.every, or null. */
  every?: string | null;
  /** Runtime resolution source. Local repo assets win over store assets. */
  source?: "local" | "store";
  /** Store-linked assets are visible and runnable, but not editable locally. */
  readOnly?: boolean;
}

export interface AgentActionDetail extends AgentActionSummary {
  /** Engine file is still prompt.md; product concept is "instructions". */
  prompt: string;
  model: string;
  permissionMode: AgentActionFields["permissionMode"];
  tools: string[];
  skills: AgentActionSkill[];
  shellScripts: AgentActionShellScript[];
  /** External MCP tool servers (`claudeCode.mcpServers`). */
  mcpServers: McpServerSpec[];
  /** The raw profile.json text, for the advanced editor. */
  profileJson: string;
}

export interface WriteAgentActionFolderFilesOptions {
  octokit: Octokit;
  slug: string;
  files: Record<string, string>;
  isUpdate?: boolean;
}

async function getStateRepoContext(
  octokit: Octokit,
): Promise<{ target: StateRepoTarget; branch: string }> {
  const target = await resolveStateRepo(octokit, getOwner(), getRepo());
  const { data } = await octokit.repos.get({
    owner: target.owner,
    repo: target.repo,
  });
  return { target, branch: data.default_branch };
}

function buildHtmlUrl(
  target: StateRepoTarget,
  slug: string,
  branch: string | null,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${target.owner}/${target.repo}/tree/${ref}/${stateRepoPath(target, `${storage.dir}/${slug}`)}`;
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

function parseProfileJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function summaryFromProfile(
  slug: string,
  profile: Record<string, unknown>,
  htmlUrl: string,
  extra: Partial<Pick<AgentActionSummary, "source" | "readOnly">> = {},
): AgentActionSummary {
  const describe = typeof profile.describe === "string" ? profile.describe : "";
  const capabilityKind = isCapabilityKind(profile.capabilityKind)
    ? profile.capabilityKind
    : DEFAULT_CAPABILITY_KIND;
  const landing: AgentActionLanding =
    profile.lifecycle === "pr-branch" ? "pr" : "comment";
  const agent =
    typeof profile.agent === "string" && profile.agent.trim()
      ? profile.agent.trim()
      : null;
  const every =
    typeof profile.every === "string" && profile.every.trim()
      ? profile.every.trim()
      : null;
  return {
    slug,
    describe,
    capabilityKind,
    landing,
    updatedAt: null,
    htmlUrl,
    agent,
    every,
    ...extra,
  };
}

async function readFileText(
  octokit: Octokit,
  path: string,
): Promise<string | null> {
  const file = await readStateText(octokit, getOwner(), getRepo(), path);
  return file?.content ?? null;
}

/**
 * List every agentAction folder under `agent-actions/`. Returns `[]` if the
 * directory does not exist (fresh repo).
 */
async function listAgentActionFolders(
  octokit: Octokit,
  target: StateRepoTarget,
  branch: string | null,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionSummary[]> {
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    storage.dir,
  );

  const slugs = entries
    .filter((e) => e.type === "dir" && isValidSlug(e.name))
    .map((e) => e.name);

  const summaries = await Promise.all(
    slugs.map(async (slug): Promise<AgentActionSummary | null> => {
      const profilePath = `${storage.dir}/${slug}/profile.json`;
      const raw = await readFileText(octokit, profilePath).catch(() => null);
      if (raw === null) return null; // folder without a profile.json — skip
      const profile = parseProfileJson(raw);
      const describe =
        profile && typeof profile.describe === "string" ? profile.describe : "";
      const capabilityKind =
        profile && isCapabilityKind(profile.capabilityKind)
          ? profile.capabilityKind
          : DEFAULT_CAPABILITY_KIND;
      const landing: AgentActionLanding =
        profile?.lifecycle === "pr-branch" ? "pr" : "comment";
      const agent =
        profile && typeof profile.agent === "string" && profile.agent.trim()
          ? profile.agent.trim()
          : null;
      // No per-agentResponsibility fetchLastCommitDate here: it's one listCommits call PER agentResponsibility,
      // which drains the shared GitHub token on every list render (see
      // CLAUDE.md rate-limit rules). The detail view shows the commit date.
      const every =
        profile && typeof profile.every === "string" && profile.every.trim()
          ? profile.every.trim()
          : null;
      return {
        slug,
        describe,
        capabilityKind,
        landing,
        updatedAt: null,
        htmlUrl: buildHtmlUrl(target, slug, branch, storage),
        agent,
        every,
      };
    }),
  );

  return summaries.filter((s): s is AgentActionSummary => s !== null);
}

/** List every agentAction under `agent-actions/`, sorted by slug. */
export async function listLocalAgentActionFiles(): Promise<
  AgentActionSummary[]
> {
  const octokit = getOctokit();
  const { target, branch } = await getStateRepoContext(octokit);
  return listAgentActionFolders(octokit, target, branch);
}

export async function listLocalCapabilityFiles(): Promise<
  AgentActionSummary[]
> {
  const octokit = getOctokit();
  const { target, branch } = await getStateRepoContext(octokit);
  return listAgentActionFolders(octokit, target, branch, CAPABILITY_STORAGE);
}

export async function listAgentActionFiles(): Promise<AgentActionSummary[]> {
  const octokit = getOctokit();
  const { target, branch } = await getStateRepoContext(octokit);

  const local = await listAgentActionFolders(octokit, target, branch);
  const store = await listStoreAgentActionFiles(
    octokit,
    new Set(local.map((e) => e.slug)),
  );
  return mergeAssetsBySlug(local, store);
}

export async function listCapabilityFiles(): Promise<AgentActionSummary[]> {
  const octokit = getOctokit();
  const { target, branch } = await getStateRepoContext(octokit);

  const local = await listAgentActionFolders(
    octokit,
    target,
    branch,
    CAPABILITY_STORAGE,
  );
  const store = await listStoreAgentActionFiles(
    octokit,
    new Set(local.map((e) => e.slug)),
    CAPABILITY_STORAGE,
  );
  return mergeAssetsBySlug(local, store);
}

async function listStoreAgentActionFiles(
  octokit: Octokit,
  localSlugs: Set<string>,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionSummary[]> {
  const slugs = await listCompanyStoreAssetSlugs(
    octokit,
    storage.storeKind,
    isValidSlug,
  );
  const summaries = await Promise.all(
    slugs
      .filter((slug) => !localSlugs.has(slug))
      .map((slug) => readStoreAgentActionSummary(slug, octokit, storage)),
  );
  return summaries.filter((s): s is AgentActionSummary => s !== null);
}

async function readStoreAgentActionSummary(
  slug: string,
  octokit: Octokit,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionSummary | null> {
  const profileRaw = await readCompanyStoreText(
    octokit,
    `.kody/${storage.storeKind}/${slug}/profile.json`,
  );
  if (!profileRaw) return null;
  const profile = parseProfileJson(profileRaw);
  if (!profile) return null;
  return summaryFromProfile(
    slug,
    profile,
    buildCompanyStoreHtmlUrl(storage.storeKind, slug),
    {
      source: "store",
      readOnly: true,
    },
  );
}

export async function readResolvedAgentActionFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentActionDetail | null> {
  const local = await readAgentActionFile(slug, octokitOverride);
  if (local) return local;
  return readStoreAgentActionFile(slug, octokitOverride ?? getOctokit());
}

export async function readResolvedCapabilityFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentActionDetail | null> {
  const local = await readCapabilityFile(slug, octokitOverride);
  if (local) return local;
  return readStoreAgentActionFile(
    slug,
    octokitOverride ?? getOctokit(),
    CAPABILITY_STORAGE,
  );
}

/** Read a single agentAction folder into the full editable detail. */
export async function readAgentActionFile(
  slug: string,
  octokitOverride?: Octokit,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionDetail | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const { target, branch } = await getStateRepoContext(octokit);

  const base = `${storage.dir}/${slug}`;
  const profileRaw = await readFileText(octokit, `${base}/profile.json`);
  if (profileRaw === null) return null;

  const profile = parseProfileJson(profileRaw);
  if (!profile) return null;
  const agent =
    typeof profile.agent === "string" && profile.agent.trim()
      ? profile.agent.trim()
      : null;

  // The stored prompt.md ends with the managed output-format contract;
  // strip it so the editor shows only the user-authored instructions.
  const prompt = stripContract(
    (await readFileText(octokit, `${base}/${storage.bodyFile}`)) ?? "",
  );

  // Enumerate the folder once to find `*.sh` files and the skills/ subdir.
  const entries = (await readDirectoryEntries(octokit, base)) ?? [];

  const shellScripts = await Promise.all(
    entries
      .filter((e) => e.type === "file" && e.name.endsWith(".sh"))
      .map(
        async (e): Promise<AgentActionShellScript> => ({
          name: e.name,
          content: (await readFileText(octokit, `${base}/${e.name}`)) ?? "",
        }),
      ),
  );

  const skills = entries.some((e) => e.type === "dir" && e.name === "skills")
    ? await readSkills(octokit, `${base}/skills`)
    : [];

  const fields = fieldsFromProfile(slug, profile);
  return {
    slug,
    describe: fields.describe,
    capabilityKind: fields.capabilityKind,
    landing: fields.landing,
    updatedAt: await fetchLastCommitDate(octokit, `${base}/profile.json`),
    htmlUrl: buildHtmlUrl(target, slug, branch, storage),
    agent,
    prompt,
    model: fields.model,
    permissionMode: fields.permissionMode,
    tools: fields.tools,
    skills,
    shellScripts,
    mcpServers: fields.mcpServers,
    profileJson: profileRaw,
  };
}

export async function readCapabilityFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentActionDetail | null> {
  return readAgentActionFile(slug, octokitOverride, CAPABILITY_STORAGE);
}

async function readStoreAgentActionFile(
  slug: string,
  octokit: Octokit,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionDetail | null> {
  if (!isValidSlug(slug)) return null;
  const base = `.kody/${storage.storeKind}/${slug}`;
  const profileRaw = await readCompanyStoreText(
    octokit,
    `${base}/profile.json`,
  );
  if (profileRaw === null) return null;
  const profile = parseProfileJson(profileRaw);
  if (!profile) return null;
  const prompt = stripContract(
    (await readCompanyStoreText(octokit, `${base}/${storage.bodyFile}`)) ?? "",
  );
  const entries = await listCompanyStoreDirectorySafe(octokit, base);
  const shellScripts = await Promise.all(
    entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".sh"))
      .map(
        async (entry): Promise<AgentActionShellScript> => ({
          name: entry.name,
          content:
            (await readCompanyStoreText(octokit, `${base}/${entry.name}`)) ??
            "",
        }),
      ),
  );
  const skills = entries.some(
    (entry) => entry.type === "dir" && entry.name === "skills",
  )
    ? await readStoreSkills(octokit, `${base}/skills`)
    : [];
  const fields = fieldsFromProfile(slug, profile);
  const summary = summaryFromProfile(
    slug,
    profile,
    buildCompanyStoreHtmlUrl(storage.storeKind, slug),
    {
      source: "store",
      readOnly: true,
    },
  );
  return {
    ...summary,
    prompt,
    model: fields.model,
    permissionMode: fields.permissionMode,
    tools: fields.tools,
    skills,
    shellScripts,
    mcpServers: fields.mcpServers,
    profileJson: profileRaw,
  };
}

async function readStoreSkills(
  octokit: Octokit,
  skillsPath: string,
): Promise<AgentActionSkill[]> {
  const dirs = await listCompanyStoreDirectorySafe(octokit, skillsPath);
  const skills = await Promise.all(
    dirs
      .filter((entry) => entry.type === "dir")
      .map(
        async (entry): Promise<AgentActionSkill> => ({
          name: entry.name,
          body:
            (await readCompanyStoreText(
              octokit,
              `${skillsPath}/${entry.name}/SKILL.md`,
            )) ?? "",
        }),
      ),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function readSkills(
  octokit: Octokit,
  skillsPath: string,
): Promise<AgentActionSkill[]> {
  const dirs = (await readDirectoryEntries(octokit, skillsPath)) ?? [];
  const skills = await Promise.all(
    dirs
      .filter((e) => e.type === "dir")
      .map(
        async (e): Promise<AgentActionSkill> => ({
          name: e.name,
          body:
            (await readFileText(octokit, `${skillsPath}/${e.name}/SKILL.md`)) ??
            "",
        }),
      ),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function assertSafeAgentActionPath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new Error(`Invalid agentAction file path: "${path}"`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid agentAction file path: "${path}"`);
  }
}

async function readDirectoryEntries(
  octokit: Octokit,
  path: string,
): Promise<Array<{ name: string; type: string }> | null> {
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    path,
  );
  return entries.length > 0 ? entries : null;
}

async function readFolderFilesRecursive(
  octokit: Octokit,
  absolutePath: string,
  relativePath: string,
  out: Record<string, string>,
): Promise<boolean> {
  const entries = await readDirectoryEntries(octokit, absolutePath);
  if (entries === null) return false;

  for (const entry of entries) {
    const childAbsolutePath = `${absolutePath}/${entry.name}`;
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (entry.type === "dir") {
      await readFolderFilesRecursive(
        octokit,
        childAbsolutePath,
        childRelativePath,
        out,
      );
    } else if (entry.type === "file") {
      const content = await readFileText(octokit, childAbsolutePath);
      if (content !== null) out[childRelativePath] = content;
    }
  }
  return true;
}

/** Read every text file under `agent-actions/<slug>/`, recursively. */
export async function readAgentActionFolderFiles(
  slug: string,
  octokitOverride?: Octokit,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<Record<string, string> | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const files: Record<string, string> = {};
  const exists = await readFolderFilesRecursive(
    octokit,
    `${storage.dir}/${slug}`,
    "",
    files,
  );
  return exists ? files : null;
}

export async function readCapabilityFolderFiles(
  slug: string,
  octokitOverride?: Octokit,
): Promise<Record<string, string> | null> {
  return readAgentActionFolderFiles(slug, octokitOverride, CAPABILITY_STORAGE);
}

// ────────────────────────────────────────────────────────────────────────────
// Atomic folder write/delete via the Git Data API.
// ────────────────────────────────────────────────────────────────────────────

interface TreeChange {
  path: string;
  /** File content; `null` deletes the path. */
  content: string | null;
}

/** Commit a set of file additions/deletions in a single commit. */
async function commitChanges(
  octokit: Octokit,
  changes: TreeChange[],
  message: string,
): Promise<void> {
  const { target, branch } = await getStateRepoContext(octokit);

  const { data: ref } = await octokit.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
  });
  const baseCommitSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({
    owner: target.owner,
    repo: target.repo,
    commit_sha: baseCommitSha,
  });

  const tree = await Promise.all(
    changes.map(async (c) => {
      if (c.content === null) {
        return {
          path: stateRepoPath(target, c.path),
          mode: "100644" as const,
          type: "blob" as const,
          sha: null,
        };
      }
      const { data: blob } = await octokit.git.createBlob({
        owner: target.owner,
        repo: target.repo,
        content: Buffer.from(c.content, "utf-8").toString("base64"),
        encoding: "base64",
      });
      return {
        path: stateRepoPath(target, c.path),
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    }),
  );

  const { data: newTree } = await octokit.git.createTree({
    owner: target.owner,
    repo: target.repo,
    base_tree: baseCommit.tree.sha,
    tree,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner: target.owner,
    repo: target.repo,
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });
  await octokit.git.updateRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

export interface WriteAgentActionOptions {
  octokit: Octokit;
  fields: AgentActionFields;
  skills: AgentActionSkill[];
  shellScripts: AgentActionShellScript[];
  /** Optional raw profile.json override; when set, wins over `fields`. */
  profileJsonOverride?: string;
  /** Existing slugs of skills/sh removed in the editor, to delete their files. */
  removedSkills?: string[];
  removedShellScripts?: string[];
  isUpdate?: boolean;
}

/**
 * Write (create or update) an agentAction folder in one commit. `fields`
 * generate `profile.json` and `prompt.md`; `skills`/`shellScripts` write the
 * colocated files; removed entries are deleted in the same commit.
 */
export async function writeAgentActionFile(
  opts: WriteAgentActionOptions,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<AgentActionDetail> {
  const { fields } = opts;
  if (!isValidSlug(fields.slug)) {
    throw new Error(
      `Invalid ${storage.conceptName} slug: "${fields.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  // Keep claudeCode.skills and the shell preflight steps in sync with the
  // actual files being written, so the engine never references a missing part.
  const syncedFields: AgentActionFields = {
    ...fields,
    skills: opts.skills.map((s) => s.name),
    shellScripts: opts.shellScripts.map((s) => s.name),
  };
  const profileJson =
    opts.profileJsonOverride ?? serializeProfile(composeProfile(syncedFields));

  // All agentActions live under the agentAction home. `isUpdate` covers the
  // create-vs-update diff at the commit-message level; the file paths
  // are identical for both.
  const base = `${storage.dir}/${fields.slug}`;
  const changes: TreeChange[] = [
    { path: `${base}/profile.json`, content: profileJson },
    {
      path: `${base}/${storage.bodyFile}`,
      // Append the managed output-format contract so the marker block is the
      // agent's final instruction (it ignores a system-prompt-only contract).
      content: ensureTrailingNewline(
        appendContract(fields.prompt, fields.landing),
      ),
    },
  ];
  for (const s of opts.shellScripts) {
    changes.push({
      path: `${base}/${s.name}`,
      content: ensureTrailingNewline(s.content),
    });
  }
  for (const s of opts.skills) {
    changes.push({
      path: `${base}/skills/${s.name}/SKILL.md`,
      content: ensureTrailingNewline(s.body),
    });
  }
  for (const name of opts.removedShellScripts ?? []) {
    changes.push({ path: `${base}/${name}`, content: null });
  }
  for (const name of opts.removedSkills ?? []) {
    changes.push({ path: `${base}/skills/${name}/SKILL.md`, content: null });
  }

  const verb = opts.isUpdate ? "update" : "add";
  await commitChanges(
    opts.octokit,
    changes,
    `${opts.isUpdate ? "chore" : "feat"}(${storage.commitScope}): ${verb} ${fields.slug}`,
  );

  const refreshed = await readAgentActionFile(
    fields.slug,
    opts.octokit,
    storage,
  );
  if (!refreshed) {
    throw new Error(
      `writeAgentActionFile: ${storage.conceptName} folder was written but could not be re-read`,
    );
  }
  return refreshed;
}

export async function writeCapabilityFile(
  opts: WriteAgentActionOptions,
): Promise<AgentActionDetail> {
  return writeAgentActionFile(opts, CAPABILITY_STORAGE);
}

/** Write an agentAction folder exactly from a path→content map. */
export async function writeAgentActionFolderFiles(
  opts: WriteAgentActionFolderFilesOptions,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<void> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(`Invalid ${storage.conceptName} slug: "${opts.slug}".`);
  }

  const base = `${storage.dir}/${opts.slug}`;
  const nextPaths = Object.keys(opts.files).sort();
  for (const path of nextPaths) assertSafeAgentActionPath(path);

  const existing = await readAgentActionFolderFiles(
    opts.slug,
    opts.octokit,
    storage,
  );
  const existingPaths = existing ? Object.keys(existing) : [];
  const nextPathSet = new Set(nextPaths);

  const changes: TreeChange[] = nextPaths.map((path) => ({
    path: `${base}/${path}`,
    content: opts.files[path] ?? "",
  }));
  for (const path of existingPaths.sort()) {
    if (!nextPathSet.has(path)) {
      changes.push({ path: `${base}/${path}`, content: null });
    }
  }

  const verb = opts.isUpdate ? "update" : "add";
  await commitChanges(
    opts.octokit,
    changes,
    `${opts.isUpdate ? "chore" : "feat"}(${storage.commitScope}): ${verb} ${opts.slug}`,
  );
}

export async function writeCapabilityFolderFiles(
  opts: WriteAgentActionFolderFilesOptions,
): Promise<void> {
  return writeAgentActionFolderFiles(opts, CAPABILITY_STORAGE);
}

/** Delete an agentAction folder (every file under it) in one commit. */
export async function deleteAgentActionFile(
  octokit: Octokit,
  slug: string,
  storage: AgentActionStorage = AGENT_ACTION_STORAGE,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid ${storage.conceptName} slug: "${slug}".`);
  }
  const existing = await readAgentActionFile(slug, octokit, storage);
  if (!existing) return;
  const base = `${storage.dir}/${slug}`;
  const changes: TreeChange[] = [
    { path: `${base}/profile.json`, content: null },
    { path: `${base}/${storage.bodyFile}`, content: null },
  ];
  for (const s of existing.shellScripts)
    changes.push({ path: `${base}/${s.name}`, content: null });
  for (const s of existing.skills)
    changes.push({ path: `${base}/skills/${s.name}/SKILL.md`, content: null });
  await commitChanges(
    octokit,
    changes,
    `chore(${storage.commitScope}): remove ${slug}`,
  );
}

export async function deleteCapabilityFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  return deleteAgentActionFile(octokit, slug, CAPABILITY_STORAGE);
}

function ensureTrailingNewline(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length === 0 ? "" : `${trimmed}\n`;
}
