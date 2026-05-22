/**
 * @fileType util
 * @domain kody
 * @pattern company-migrate
 * @ai-summary One-time legacy migration for the Jobs→Duties / Workers→Staff
 *   rename. Moves a connected repo's `.kody/jobs/*` → `.kody/duties/*` and
 *   `.kody/workers/*` → `.kody/staff/*` via the GitHub contents API, and
 *   rewrites the duty frontmatter key `worker:` → `staff:` so the renamed
 *   engine (≥ 0.4.122) can resolve executors. `.state.json` siblings move
 *   verbatim so prior tick state survives. Idempotent: a repo with no
 *   legacy folders reports zero moves. Runs with a user octokit that can
 *   commit (see the API route).
 */

import type { Octokit } from "@octokit/rest";
import {
  getOwner,
  getRepo,
  invalidateDutiesCache,
  invalidateStaffCache,
} from "../github-client";

export interface CompanyMigrationResult {
  /** Files moved per legacy folder. */
  duties: { moved: number; from: ".kody/jobs"; to: ".kody/duties" };
  staff: { moved: number; from: ".kody/workers"; to: ".kody/staff" };
  /** Per-file notes (failures or skips), newest last. */
  notes: string[];
  /** True when nothing legacy was found (already migrated / fresh repo). */
  noop: boolean;
}

/** Rewrite the `worker:` frontmatter line to `staff:` inside the leading
 *  `---` block only — never in the duty body. No-op when absent. Exported
 *  for unit tests. */
export function rewriteStaffKey(content: string): string {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/.exec(content);
  if (!fm) return content;
  const rewritten = fm[2]!.replace(/^worker:(.*)$/m, "staff:$1");
  if (rewritten === fm[2]) return content;
  return fm[1]! + rewritten + fm[3]! + content.slice(fm[0].length);
}

interface DirEntry {
  name: string;
  sha: string;
  type: string;
}

async function listDir(octokit: Octokit, dir: string): Promise<DirEntry[]> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: dir,
    });
    if (!Array.isArray(data)) return [];
    return data as DirEntry[];
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 404) return [];
    throw err;
  }
}

/**
 * Move every file under `from` to `to`. `.md` files get the frontmatter
 * key rewrite when `rewrite` is true; everything else moves verbatim.
 * Each file is created at the destination then deleted at the source.
 */
async function moveDir(
  octokit: Octokit,
  from: string,
  to: string,
  rewrite: boolean,
  notes: string[],
): Promise<number> {
  const entries = (await listDir(octokit, from)).filter(
    (e) => e.type === "file",
  );
  let moved = 0;
  for (const entry of entries) {
    const fromPath = `${from}/${entry.name}`;
    const toPath = `${to}/${entry.name}`;
    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: fromPath,
      });
      if (Array.isArray(data) || !("content" in data) || !data.content) {
        notes.push(`${fromPath}: unreadable, skipped`);
        continue;
      }
      let body = Buffer.from(data.content, "base64").toString("utf-8");
      if (rewrite && entry.name.endsWith(".md")) {
        body = rewriteStaffKey(body);
      }
      await octokit.repos.createOrUpdateFileContents({
        owner: getOwner(),
        repo: getRepo(),
        path: toPath,
        message: `chore(migrate): move ${fromPath} → ${toPath}`,
        content: Buffer.from(body, "utf-8").toString("base64"),
      });
      await octokit.repos.deleteFile({
        owner: getOwner(),
        repo: getRepo(),
        path: fromPath,
        message: `chore(migrate): remove legacy ${fromPath}`,
        sha: data.sha,
      });
      moved++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`${fromPath}: ${msg}`);
    }
  }
  return moved;
}

/**
 * Migrate the connected repo's legacy folders to the new layout. Staff
 * moves verbatim (personas have no `worker:` key); duties get the
 * frontmatter key rewrite.
 */
export async function migrateRepoToDutiesStaff(
  octokit: Octokit,
): Promise<CompanyMigrationResult> {
  const notes: string[] = [];
  const dutiesMoved = await moveDir(
    octokit,
    ".kody/jobs",
    ".kody/duties",
    true,
    notes,
  );
  const staffMoved = await moveDir(
    octokit,
    ".kody/workers",
    ".kody/staff",
    false,
    notes,
  );

  if (dutiesMoved > 0) invalidateDutiesCache();
  if (staffMoved > 0) invalidateStaffCache();

  return {
    duties: { moved: dutiesMoved, from: ".kody/jobs", to: ".kody/duties" },
    staff: { moved: staffMoved, from: ".kody/workers", to: ".kody/staff" },
    notes,
    noop: dutiesMoved === 0 && staffMoved === 0,
  };
}
