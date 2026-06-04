/**
 * @fileType util
 * @domain executables
 * @pattern executables-files
 * @ai-summary Read/write custom executables under `.kody/executables/<slug>/`
 *   via GitHub. An executable is a *folder* (profile.json + prompt.md +
 *   optional `*.sh` + optional `skills/<name>/SKILL.md`), so unlike the
 *   single-file commands/duties helpers this commits the whole folder
 *   atomically using the Git Data API (one blob per file → one tree → one
 *   commit). The engine reads this exact path first when resolving `@kody
 *   <slug>` (registry root `.kody/executables` precedes `src/executables`).
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import { listDutyFiles } from "../duties-files";
import {
  appendContract,
  composeProfile,
  fieldsFromProfile,
  isValidSlug,
  serializeProfile,
  stripContract,
  type ExecutableFields,
  type ExecutableLanding,
  type McpServerSpec,
} from "./profile";

export { isValidSlug } from "./profile";

/**
 * Folder-duties live at `.kody/duties/<slug>/`. During the executable→duty
 * migration we still READ legacy folders at `.kody/executables/<slug>/` so a
 * not-yet-migrated repo's duties still show; all WRITES go to `.kody/duties/`.
 * Each summary/detail carries the `dir` it was found in so edits/links target
 * the right place.
 */
const DUTIES_DIR = ".kody/duties";
const LEGACY_EXECUTABLES_DIR = ".kody/executables";
/** Read order: duty home first, legacy second (duty wins on slug conflict). */
const FOLDER_DIRS = [DUTIES_DIR, LEGACY_EXECUTABLES_DIR] as const;

export interface ExecutableSkill {
  /** Skill folder name under `skills/`. */
  name: string;
  /** `SKILL.md` contents. */
  body: string;
}

export interface ExecutableShellScript {
  /** `.sh` filename (e.g. `setup.sh`). */
  name: string;
  /** Script contents. */
  content: string;
}

export interface ExecutableSummary {
  slug: string;
  describe: string;
  landing: ExecutableLanding;
  /** Last-commit date; null in the list view (per-duty lookups are rate-limited). */
  updatedAt: string | null;
  htmlUrl: string;
  /** Staff member this duty runs as (profile.staff), or null. */
  staff: string | null;
  /** The folder dir this was found in (`.kody/duties` or legacy `.kody/executables`). */
  dir: string;
  /** True when still under the legacy `.kody/executables/` dir (pre-migration). */
  legacy: boolean;
  /** True for a legacy markdown duty (`.kody/duties/<slug>.md`) — being migrated to a folder. */
  markdown?: boolean;
  /** Recurrence cadence from profile.every (scheduled folder-duty), or null. */
  every?: string | null;
}

export interface ExecutableDetail extends ExecutableSummary {
  prompt: string;
  model: string;
  permissionMode: ExecutableFields["permissionMode"];
  tools: string[];
  skills: ExecutableSkill[];
  shellScripts: ExecutableShellScript[];
  /** External MCP tool servers (`claudeCode.mcpServers`). */
  mcpServers: McpServerSpec[];
  /** The raw profile.json text, for the advanced editor. */
  profileJson: string;
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  return data.default_branch;
}

function buildHtmlUrl(
  slug: string,
  branch: string | null,
  dir: string,
): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/tree/${ref}/${dir}/${slug}`;
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

async function readFileText(
  octokit: Octokit,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

/**
 * List every executable folder under `.kody/executables/` that contains a
 * `profile.json`. Returns `[]` when the directory does not exist.
 */
/** List folder-duty summaries under a single dir. `[]` if the dir is absent. */
async function listFolderDutiesInDir(
  octokit: Octokit,
  dir: string,
  branch: string | null,
): Promise<ExecutableSummary[]> {
  let entries: Array<{ name: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: dir,
    });
    if (!Array.isArray(data)) return [];
    entries = data as Array<{ name: string; type: string }>;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }

  const slugs = entries
    .filter((e) => e.type === "dir" && isValidSlug(e.name))
    .map((e) => e.name);

  const summaries = await Promise.all(
    slugs.map(async (slug): Promise<ExecutableSummary | null> => {
      const profilePath = `${dir}/${slug}/profile.json`;
      const raw = await readFileText(octokit, profilePath).catch(() => null);
      if (raw === null) return null; // folder without a profile.json — skip
      const profile = parseProfileJson(raw);
      const describe =
        profile && typeof profile.describe === "string" ? profile.describe : "";
      const landing: ExecutableLanding =
        profile?.lifecycle === "pr-branch" ? "pr" : "comment";
      const staff =
        profile && typeof profile.staff === "string" && profile.staff.trim()
          ? profile.staff.trim()
          : null;
      // No per-duty fetchLastCommitDate here: it's one listCommits call PER duty,
      // which drains the shared GitHub token on every list render (see
      // CLAUDE.md rate-limit rules). The detail view shows the commit date.
      const every =
        profile && typeof profile.every === "string" && profile.every.trim()
          ? profile.every.trim()
          : null;
      return {
        slug,
        describe,
        landing,
        updatedAt: null,
        htmlUrl: buildHtmlUrl(slug, branch, dir),
        staff,
        dir,
        legacy: dir === LEGACY_EXECUTABLES_DIR,
        every,
      };
    }),
  );

  return summaries.filter((s): s is ExecutableSummary => s !== null);
}

/**
 * List every folder-duty across the duty home (`.kody/duties/`) and the legacy
 * executables dir (`.kody/executables/`). On slug conflict the duty home wins,
 * so a migrated duty shadows its legacy copy.
 */
export async function listExecutableFiles(): Promise<ExecutableSummary[]> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  const perDir = await Promise.all(
    FOLDER_DIRS.map((dir) => listFolderDutiesInDir(octokit, dir, branch)),
  );

  const bySlug = new Map<string, ExecutableSummary>();
  for (const summaries of perDir) {
    for (const s of summaries) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, s); // first (duty home) wins
    }
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * List legacy markdown duties (`.kody/duties/<slug>.md`) as summaries so they
 * appear in the SAME single duty list (not a separate tab) until each is
 * migrated to a folder-duty. Cheap: one directory listing, ZERO per-duty reads
 * (so no staff/schedule detail — that needs the file, which the rate-limit
 * rules forbid fetching per row). Marked `markdown: true` for the "legacy" badge.
 */
export async function listMarkdownDutySummaries(): Promise<
  ExecutableSummary[]
> {
  const branch = await getDefaultBranch(getOctokit()).catch(() => null);
  const files = await listDutyFiles().catch(
    () => [] as Awaited<ReturnType<typeof listDutyFiles>>,
  );
  return files.map((f) => ({
    slug: f.slug,
    describe: f.title ?? f.slug,
    landing: "comment" as ExecutableLanding,
    updatedAt: null,
    htmlUrl: `https://github.com/${getOwner()}/${getRepo()}/blob/${branch ?? "HEAD"}/${DUTIES_DIR}/${f.slug}.md`,
    staff: null,
    dir: DUTIES_DIR,
    legacy: true,
    markdown: true,
  }));
}

/** Read a single executable folder into the full editable detail. */
export async function readExecutableFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<ExecutableDetail | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  // Resolve which dir holds this slug: duty home first, legacy second.
  let dir: string | null = null;
  let profileRaw: string | null = null;
  for (const candidate of FOLDER_DIRS) {
    const raw = await readFileText(
      octokit,
      `${candidate}/${slug}/profile.json`,
    );
    if (raw !== null) {
      dir = candidate;
      profileRaw = raw;
      break;
    }
  }
  if (dir === null || profileRaw === null) return null;
  const base = `${dir}/${slug}`;

  const profile = parseProfileJson(profileRaw);
  if (!profile) return null;
  const staff =
    typeof profile.staff === "string" && profile.staff.trim()
      ? profile.staff.trim()
      : null;

  // The stored prompt.md ends with the managed output-format contract;
  // strip it so the editor shows only the user-authored part.
  const prompt = stripContract(
    (await readFileText(octokit, `${base}/prompt.md`)) ?? "",
  );

  // Enumerate the folder once to find `*.sh` files and the skills/ subdir.
  let entries: Array<{ name: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: base,
    });
    if (Array.isArray(data))
      entries = data as Array<{ name: string; type: string }>;
  } catch {
    entries = [];
  }

  const shellScripts = await Promise.all(
    entries
      .filter((e) => e.type === "file" && e.name.endsWith(".sh"))
      .map(
        async (e): Promise<ExecutableShellScript> => ({
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
    landing: fields.landing,
    updatedAt: await fetchLastCommitDate(octokit, `${base}/profile.json`),
    htmlUrl: buildHtmlUrl(slug, branch, dir),
    staff,
    dir,
    legacy: dir === LEGACY_EXECUTABLES_DIR,
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

async function readSkills(
  octokit: Octokit,
  skillsPath: string,
): Promise<ExecutableSkill[]> {
  let dirs: Array<{ name: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: skillsPath,
    });
    if (Array.isArray(data))
      dirs = data as Array<{ name: string; type: string }>;
  } catch {
    return [];
  }
  const skills = await Promise.all(
    dirs
      .filter((e) => e.type === "dir")
      .map(
        async (e): Promise<ExecutableSkill> => ({
          name: e.name,
          body:
            (await readFileText(octokit, `${skillsPath}/${e.name}/SKILL.md`)) ??
            "",
        }),
      ),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
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
  const owner = getOwner();
  const repo = getRepo();
  const branch = await getDefaultBranch(octokit);

  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const baseCommitSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });

  const tree = await Promise.all(
    changes.map(async (c) => {
      if (c.content === null) {
        return {
          path: c.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: null,
        };
      }
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(c.content, "utf-8").toString("base64"),
        encoding: "base64",
      });
      return {
        path: c.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    }),
  );

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

export interface WriteExecutableOptions {
  octokit: Octokit;
  fields: ExecutableFields;
  skills: ExecutableSkill[];
  shellScripts: ExecutableShellScript[];
  /** Optional raw profile.json override; when set, wins over `fields`. */
  profileJsonOverride?: string;
  /** Existing slugs of skills/sh removed in the editor, to delete their files. */
  removedSkills?: string[];
  removedShellScripts?: string[];
  isUpdate?: boolean;
}

/**
 * Write (create or update) an executable folder in one commit. `fields`
 * generate `profile.json` and `prompt.md`; `skills`/`shellScripts` write the
 * colocated files; removed entries are deleted in the same commit.
 */
export async function writeExecutableFile(
  opts: WriteExecutableOptions,
): Promise<ExecutableDetail> {
  const { fields } = opts;
  if (!isValidSlug(fields.slug)) {
    throw new Error(
      `Invalid executable slug: "${fields.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  // Keep claudeCode.skills and the shell preflight steps in sync with the
  // actual files being written, so the engine never references a missing part.
  const syncedFields: ExecutableFields = {
    ...fields,
    skills: opts.skills.map((s) => s.name),
    shellScripts: opts.shellScripts.map((s) => s.name),
  };
  const profileJson =
    opts.profileJsonOverride ?? serializeProfile(composeProfile(syncedFields));

  // Edit a duty where it already lives (so editing a legacy executable updates
  // it in place); new duties are created under the duty home `.kody/duties/`.
  const existingDir = await resolveExistingFolderDir(opts.octokit, fields.slug);
  const base = `${existingDir ?? DUTIES_DIR}/${fields.slug}`;
  const changes: TreeChange[] = [
    { path: `${base}/profile.json`, content: profileJson },
    {
      path: `${base}/prompt.md`,
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
    `${opts.isUpdate ? "chore" : "feat"}(duty): ${verb} ${fields.slug}`,
  );

  const refreshed = await readExecutableFile(fields.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeExecutableFile: folder was written but could not be re-read",
    );
  }
  return refreshed;
}

/** Delete an executable folder (every file under it) in one commit. */
export async function deleteExecutableFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid executable slug: "${slug}".`);
  }
  const existing = await readExecutableFile(slug, octokit);
  if (!existing) return;
  const base = `${existing.dir}/${slug}`;
  const changes: TreeChange[] = [
    { path: `${base}/profile.json`, content: null },
    { path: `${base}/prompt.md`, content: null },
  ];
  for (const s of existing.shellScripts)
    changes.push({ path: `${base}/${s.name}`, content: null });
  for (const s of existing.skills)
    changes.push({ path: `${base}/skills/${s.name}/SKILL.md`, content: null });
  await commitChanges(octokit, changes, `chore(duty): remove ${slug}`);
}

/** Find which folder dir (duty home or legacy) currently holds `slug`, or null. */
async function resolveExistingFolderDir(
  octokit: Octokit,
  slug: string,
): Promise<string | null> {
  for (const dir of FOLDER_DIRS) {
    const raw = await readFileText(
      octokit,
      `${dir}/${slug}/profile.json`,
    ).catch(() => null);
    if (raw !== null) return dir;
  }
  return null;
}

function ensureTrailingNewline(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length === 0 ? "" : `${trimmed}\n`;
}
